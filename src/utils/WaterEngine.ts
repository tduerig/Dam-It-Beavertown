import { getTerrainHeight, getBaseTerrainHeight, getRiverCenter } from './terrain';
import { globalTerrainConfig } from './terrainConfig';
import { PlacedBlock, DraggableLog } from '../store';
import { getUpdateFlag, hasAnyOffsets, getOffset } from './terrainOffsets';

import { getSimConfig } from './qualityTier';

export const WATER_SIZE = getSimConfig().waterSize;
export const WATER_HALF = WATER_SIZE / 2;

export class WaterEngine {
  size = WATER_SIZE;
  W = new Float32Array(this.size * this.size);
  T = new Float32Array(this.size * this.size);
  T_base = new Float32Array(this.size * this.size);
  VX = new Float32Array(this.size * this.size);
  VZ = new Float32Array(this.size * this.size);
  
  // Pre-allocated arrays for the simulation loop to prevent GC OOM crashes natively
  outFlow = new Float32Array(this.size * this.size * 4);
  newT = new Float32Array(this.size * this.size);
  
  originX = 0;
  originZ = 0;
  initialized = false;
  
  lastOffsetsStamp = 0;
  lastBlocksCount = 0;
  lastLogsCount = 0;
  lastOriginX: number | null = null;
  lastOriginZ: number | null = null;

  update(px: number, pz: number, blocks: PlacedBlock[], draggableLogs: DraggableLog[], dt: number, rainIntensity: number = 0) {
    const newOx = Math.floor(px);
    const newOz = Math.floor(pz);

    if (!this.initialized) {
      this.originX = newOx;
      this.originZ = newOz;
      this.initBase();
      this.initialized = true;
    } else if (newOx !== this.originX || newOz !== this.originZ) {
      this.shift(newOx, newOz);
    }

    this.updateTerrain(blocks, draggableLogs);
    
    // Apply rain
    if (rainIntensity > 0) {
      const rainAmount = rainIntensity * dt * 0.5; // Adjust rain volume here
      for (let i = 0; i < this.size * this.size; i++) {
        this.W[i] += rainAmount;
      }
    }
    
    // Run simulation steps (fixed time step for stability)
    const fixedDt = 1.0 / 60.0;
    // Cap substeps aggressively at 2 to prevent CPU death-spiral on slow VMs
    const steps = Math.min(Math.max(1, Math.ceil(dt / fixedDt)), 2);
    for (let i = 0; i < steps; i++) {
      this.simulate();
    }
  }

  initBase() {
    for (let x = 0; x < this.size; x++) {
      for (let z = 0; z < this.size; z++) {
        const wx = this.originX - WATER_HALF + x;
        const wz = this.originZ - WATER_HALF + z;
        const hBase = getBaseTerrainHeight(wx, wz);
        const hFull = getTerrainHeight(wx, wz); // Keep getTerrainHeight for W/T initially
        this.T_base[x + z * this.size] = hBase;
        this.T[x + z * this.size] = hFull;
        this.VX[x + z * this.size] = 0;
        this.VZ[x + z * this.size] = 0;
        
        const riverX = getRiverCenter(wz);
        if (Math.abs(wx - riverX) < globalTerrainConfig.riverWidth) {
          // Calculate bank height to fill river up to the banks
          const bankHeight = getTerrainHeight(riverX + globalTerrainConfig.riverWidth, wz);
          this.W[x + z * this.size] = Math.max(0, bankHeight - 0.5 - hFull);
        } else {
          this.W[x + z * this.size] = 0;
        }
      }
    }
  }

  shift(newOx: number, newOz: number) {
    const dx = newOx - this.originX;
    const dz = newOz - this.originZ;
    
    const newW = new Float32Array(this.size * this.size);
    const newT_base = new Float32Array(this.size * this.size);
    const newT = new Float32Array(this.size * this.size);
    const newVX = new Float32Array(this.size * this.size);
    const newVZ = new Float32Array(this.size * this.size);
    
    for (let x = 0; x < this.size; x++) {
      for (let z = 0; z < this.size; z++) {
        const oldX = x + dx;
        const oldZ = z + dz;
        const idx = x + z * this.size;
        
        if (oldX >= 0 && oldX < this.size && oldZ >= 0 && oldZ < this.size) {
          const oldIdx = oldX + oldZ * this.size;
          newW[idx] = this.W[oldIdx];
          newT_base[idx] = this.T_base[oldIdx];
          newT[idx] = this.T[oldIdx];
          newVX[idx] = this.VX[oldIdx];
          newVZ[idx] = this.VZ[oldIdx];
        } else {
          const wx = newOx - WATER_HALF + x;
          const wz = newOz - WATER_HALF + z;
          const hBase = getBaseTerrainHeight(wx, wz);
          const hFull = getTerrainHeight(wx, wz);
          newT_base[idx] = hBase;
          newT[idx] = hFull;
          newVX[idx] = 0;
          newVZ[idx] = 0;
          
          const riverX = getRiverCenter(wz);
          if (Math.abs(wx - riverX) < globalTerrainConfig.riverWidth) {
            const bankHeight = getTerrainHeight(riverX + globalTerrainConfig.riverWidth, wz);
            newW[idx] = Math.max(0, bankHeight - 0.5 - hFull);
          } else {
            newW[idx] = 0;
          }
        }
      }
    }
    
    this.W = newW;
    this.T_base = newT_base;
    this.T = newT;
    this.VX = newVX;
    this.VZ = newVZ;
    this.originX = newOx;
    this.originZ = newOz;
  }

  updateTerrain(blocks: PlacedBlock[], draggableLogs: DraggableLog[] = []) {
    // Read the stamp from the module-scope terrain offsets engine
    const stamp = getUpdateFlag();
    
    // Performance Optimization: Skip 25k loop overhead if nothing practically changed
    if (this.lastOffsetsStamp === stamp && 
        this.lastBlocksCount === blocks.length && 
        this.lastLogsCount === draggableLogs.length &&
        this.lastOriginX === this.originX &&
        this.lastOriginZ === this.originZ) {
       return;
    }
    this.lastOffsetsStamp = stamp;
    this.lastBlocksCount = blocks.length;
    this.lastLogsCount = draggableLogs.length;
    this.lastOriginX = this.originX;
    this.lastOriginZ = this.originZ;

    const offsetsExist = hasAnyOffsets();

    // Fast-path reconstruction from BaseTerrain Cache
    for (let i = 0; i < this.size * this.size; i++) {
        const x = i % this.size;
        const z = Math.floor(i / this.size);
        const wx = this.originX - WATER_HALF + x;
        const wz = this.originZ - WATER_HALF + z;
        
        let h = this.T_base[i];
        
        if (offsetsExist) {
            const x0 = Math.floor(wx); const x1 = x0 + 1;
            const z0 = Math.floor(wz); const z1 = z0 + 1;
            const tx = wx - x0; const tz = wz - z0;
            const v00 = getOffset(`${x0},${z0}`);
            const v10 = getOffset(`${x1},${z0}`);
            const v01 = getOffset(`${x0},${z1}`);
            const v11 = getOffset(`${x1},${z1}`);
            const nx0 = v00 * (1 - tx) + v10 * tx;
            const nx1 = v01 * (1 - tx) + v11 * tx;
            h += nx0 * (1 - tz) + nx1 * tz;
        }
        
        this.newT[i] = h;
    }

    
    for (const block of blocks) {
      const bx = block.position[0];
      const by = block.position[1];
      const bz = block.position[2];
      
      if (block.type === 'mud') {
        const cx = Math.floor(bx) - this.originX + WATER_HALF;
        const cz = Math.floor(bz) - this.originZ + WATER_HALF;
        if (cx >= 0 && cx < this.size && cz >= 0 && cz < this.size) {
          this.newT[cx + cz * this.size] = Math.max(this.newT[cx + cz * this.size], by + 0.25);
        }
      } else if (block.type === 'stick') {
        const rot = block.rotation[2];
        const dx = Math.sin(rot) * 2;
        const dz = Math.cos(rot) * 2;
        const p1x = bx - dx, p1z = bz - dz;
        const p2x = bx + dx, p2z = bz + dz;
        
        const minX = Math.max(0, Math.floor(Math.min(p1x, p2x) - 1) - this.originX + WATER_HALF);
        const maxX = Math.min(this.size - 1, Math.ceil(Math.max(p1x, p2x) + 1) - this.originX + WATER_HALF);
        const minZ = Math.max(0, Math.floor(Math.min(p1z, p2z) - 1) - this.originZ + WATER_HALF);
        const maxZ = Math.min(this.size - 1, Math.ceil(Math.max(p1z, p2z) + 1) - this.originZ + WATER_HALF);
        
        for (let x = minX; x <= maxX; x++) {
          for (let z = minZ; z <= maxZ; z++) {
            const wx = this.originX - WATER_HALF + x;
            const wz = this.originZ - WATER_HALF + z;
            
            const l2 = 16;
            let t = ((wx - p1x) * (p2x - p1x) + (wz - p1z) * (p2z - p1z)) / l2;
            t = Math.max(0, Math.min(1, t));
            const projX = p1x + t * (p2x - p1x);
            const projZ = p1z + t * (p2z - p1z);
            const dist = Math.sqrt((wx - projX)**2 + (wz - projZ)**2);
            
            if (dist < 0.8) { // Stick radius is 0.4, use 0.8 to ensure solid wall
              this.newT[x + z * this.size] = Math.max(this.newT[x + z * this.size], by + 0.4);
            }
          }
        }
      }
    }

    // Add draggable logs as obstacles
    for (const log of draggableLogs) {
      if (log.isDragged) continue; // Don't block water while being dragged
      if (log.rotation[0] < 1.0) continue; // Any rotation over 1.0 radian (e.g. resting on slope) counts as fallen
      
      const bx = log.position[0];
      const by = log.position[1];
      const bz = log.position[2];
      
      const rot = log.rotation[1]; // Y rotation
      const dx = Math.sin(rot) * 5.6; // Log is 11.2 units long
      const dz = Math.cos(rot) * 5.6;
      const p1x = bx - dx, p1z = bz - dz;
      const p2x = bx + dx, p2z = bz + dz;
      
      const minX = Math.max(0, Math.floor(Math.min(p1x, p2x) - 2) - this.originX + WATER_HALF);
      const maxX = Math.min(this.size - 1, Math.ceil(Math.max(p1x, p2x) + 2) - this.originX + WATER_HALF);
      const minZ = Math.max(0, Math.floor(Math.min(p1z, p2z) - 2) - this.originZ + WATER_HALF);
      const maxZ = Math.min(this.size - 1, Math.ceil(Math.max(p1z, p2z) + 2) - this.originZ + WATER_HALF);
      
      for (let x = minX; x <= maxX; x++) {
        for (let z = minZ; z <= maxZ; z++) {
          const wx = this.originX - WATER_HALF + x;
          const wz = this.originZ - WATER_HALF + z;
          
          const l2 = 125.44; // 11.2^2
          let t = ((wx - p1x) * (p2x - p1x) + (wz - p1z) * (p2z - p1z)) / l2;
          t = Math.max(0, Math.min(1, t));
          const projX = p1x + t * (p2x - p1x);
          const projZ = p1z + t * (p2z - p1z);
          const dist = Math.sqrt((wx - projX)**2 + (wz - projZ)**2);
          
          if (dist < 2.0) { // Log radius is ~1.12, use 2.0 for solid barrier overlapping grid diagonals
            this.newT[x + z * this.size] = Math.max(this.newT[x + z * this.size], by + 2.0); // Allow moderate overtopping unless mudded
          }
        }
      }
    }

    // Apply new terrain and displace water (prevents "slime" effect)
    for (let i = 0; i < this.size * this.size; i++) {
      const diff = this.newT[i] - this.T[i];
      if (diff > 0) {
        this.W[i] = Math.max(0, this.W[i] - diff);
      }
      this.T[i] = this.newT[i];
    }
  }

  simulate(bandStart?: number, bandEnd?: number) {
    const K = 0.25;
    const zStart = bandStart ?? 1;
    const zEnd = bandEnd ?? (this.size - 1);
    const isFullPass = (zStart <= 1 && zEnd >= this.size - 1);
    
    // Clear outFlow buffer — only clear the band we're processing + 1 row margin
    // for neighbor lookups. Full clear is needed on full pass.
    if (isFullPass) {
      this.outFlow.fill(0);
    } else {
      const clearStart = Math.max(0, zStart - 1) * this.size * 4;
      const clearEnd = Math.min(this.size, zEnd + 1) * this.size * 4;
      this.outFlow.fill(0, clearStart, clearEnd);
    }
    
    // Pass 1: Compute outflow for band (needs full neighbor read access)
    for (let z = Math.max(1, zStart); z < Math.min(this.size - 1, zEnd); z++) {
      for (let x = 1; x < this.size - 1; x++) {
        const idx = x + z * this.size;
        if (this.W[idx] <= 0.001) continue;
        
        const h = this.T[idx] + this.W[idx];
        
        const idxT = x + (z - 1) * this.size;
        const idxR = (x + 1) + z * this.size;
        const idxB = x + (z + 1) * this.size;
        const idxL = (x - 1) + z * this.size;
        
        const dhT = Math.max(0, h - (this.T[idxT] + this.W[idxT]));
        const dhR = Math.max(0, h - (this.T[idxR] + this.W[idxR]));
        const dhB = Math.max(0, h - (this.T[idxB] + this.W[idxB]));
        const dhL = Math.max(0, h - (this.T[idxL] + this.W[idxL]));
        
        let sum = dhT + dhR + dhB + dhL;
        if (sum > 0) {
          let scale = K;
          if (sum * K > this.W[idx]) {
            scale = this.W[idx] / sum;
          }
          
          const outIdx = idx * 4;
          this.outFlow[outIdx] = dhT * scale;
          this.outFlow[outIdx + 1] = dhR * scale;
          this.outFlow[outIdx + 2] = dhB * scale;
          this.outFlow[outIdx + 3] = dhL * scale;
        }
      }
    }
    
    // Pass 2: Apply flow + velocity + source/sink/absorption (merged for cache locality)
    const SEA_LEVEL = -15;
    for (let z = Math.max(1, zStart); z < Math.min(this.size - 1, zEnd); z++) {
      for (let x = 1; x < this.size - 1; x++) {
        const idx = x + z * this.size;
        const outIdx = idx * 4;
        
        const outT = this.outFlow[outIdx];
        const outR = this.outFlow[outIdx + 1];
        const outB = this.outFlow[outIdx + 2];
        const outL = this.outFlow[outIdx + 3];
        
        const inT = this.outFlow[(x + (z - 1) * this.size) * 4 + 2];
        const inR = this.outFlow[((x + 1) + z * this.size) * 4 + 3];
        const inB = this.outFlow[(x + (z + 1) * this.size) * 4 + 0];
        const inL = this.outFlow[((x - 1) + z * this.size) * 4 + 1];
        
        // Deep Occupancy Culling: Skip math completely for permanently dry cells
        if (this.W[idx] <= 0.001 && inT === 0 && inR === 0 && inB === 0 && inL === 0) {
          this.VX[idx] = 0;
          this.VZ[idx] = 0;
          continue;
        }
        
        this.W[idx] += (inT + inR + inB + inL) - (outT + outR + outB + outL);
        if (this.W[idx] < 0) this.W[idx] = 0;
        
        if (this.W[idx] > 0.01) {
          this.VX[idx] = (inL + outR - outL - inR) * 10; 
          this.VZ[idx] = (inT + outB - outT - inB) * 10;
        } else {
          this.VX[idx] = 0;
          this.VZ[idx] = 0;
        }
        
        // Ground absorption (merged into application pass for cache locality)
        const terrainH = this.T[idx];
        if (terrainH < SEA_LEVEL) {
          const targetW = SEA_LEVEL - terrainH;
          if (this.W[idx] < targetW) {
            this.W[idx] += (targetW - this.W[idx]) * 0.05;
          }
        } else if (this.W[idx] > 0) {
          this.W[idx] = Math.max(0, this.W[idx] - 0.0001);
        }
      }
    }
    
    // Source and Sink (always full-width, runs on applicable rows within band)
    for (let x = 0; x < this.size; x++) {
      const wx = this.originX - WATER_HALF + x;
      
      // Upstream Source (row 1)
      if (zStart <= 1 && zEnd > 1) {
        const sourceZ = 1;
        const globalSourceZ = this.originZ - WATER_HALF + sourceZ;
        const riverX = getRiverCenter(globalSourceZ);
        
        if (globalSourceZ > -140 && Math.abs(wx - riverX) < globalTerrainConfig.riverWidth) {
          const idx = x + sourceZ * this.size;
          this.W[idx] += 0.18; // Increased native flow for deeper twists
          if (this.W[idx] > 10.0) this.W[idx] = 10.0; 
        }
      }
      
      // Downstream Sink (last 2 rows)
      if (zEnd >= this.size - 1) {
        const sinkZ1 = this.size - 2;
        const sinkZ2 = this.size - 1;
        this.W[x + sinkZ1 * this.size] *= 0.8;
        this.W[x + sinkZ2 * this.size] = 0;
      }
    }

    // East/West Sinks (within band)
    for (let z = zStart; z < zEnd; z++) {
      this.W[0 + z * this.size] = 0;
      this.W[this.size - 1 + z * this.size] = 0;
    }
  }

  getSurfaceHeight(wx: number, wz: number): number {
    const x = Math.floor(wx) - this.originX + WATER_HALF;
    const z = Math.floor(wz) - this.originZ + WATER_HALF;
    if (x >= 0 && x < this.size && z >= 0 && z < this.size) {
      const idx = x + z * this.size;
      if (this.W[idx] > 0.15) {
        return this.T[idx] + this.W[idx];
      }
    }
    return -100;
  }

  getWaterDepth(wx: number, wz: number): number {
    const x = Math.floor(wx) - this.originX + WATER_HALF;
    const z = Math.floor(wz) - this.originZ + WATER_HALF;
    if (x >= 0 && x < this.size && z >= 0 && z < this.size) {
      const idx = x + z * this.size;
      return this.W[idx];
    }
    return 0;
  }

  getVelocity(wx: number, wz: number): { x: number, z: number } {
    const x = Math.floor(wx) - this.originX + WATER_HALF;
    const z = Math.floor(wz) - this.originZ + WATER_HALF;
    if (x >= 0 && x < this.size && z >= 0 && z < this.size) {
      const idx = x + z * this.size;
      return { x: this.VX[idx], z: this.VZ[idx] };
    }
    return { x: 0, z: 0 };
  }
}

export const waterEngine = new WaterEngine();
