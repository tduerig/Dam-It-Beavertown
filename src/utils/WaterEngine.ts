import { getTerrainHeight, getRiverCenter, RIVER_WIDTH } from './terrain';
import { PlacedBlock, DraggableLog } from '../store';

export const WATER_SIZE = 160;
export const WATER_HALF = 80;

class WaterEngine {
  size = WATER_SIZE;
  W = new Float32Array(this.size * this.size);
  T = new Float32Array(this.size * this.size);
  T_base = new Float32Array(this.size * this.size);
  VX = new Float32Array(this.size * this.size);
  VZ = new Float32Array(this.size * this.size);
  
  originX = 0;
  originZ = 0;
  initialized = false;

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
    const fixedDt = 1 / 60;
    const steps = Math.max(1, Math.ceil(dt / fixedDt)) * 4; // Run 4x faster
    for (let i = 0; i < steps; i++) {
      this.simulate();
    }
  }

  initBase() {
    for (let x = 0; x < this.size; x++) {
      for (let z = 0; z < this.size; z++) {
        const wx = this.originX - WATER_HALF + x;
        const wz = this.originZ - WATER_HALF + z;
        const h = getTerrainHeight(wx, wz);
        this.T_base[x + z * this.size] = h;
        this.T[x + z * this.size] = h;
        this.VX[x + z * this.size] = 0;
        this.VZ[x + z * this.size] = 0;
        
        const riverX = getRiverCenter(wz);
        if (Math.abs(wx - riverX) < RIVER_WIDTH) {
          // Calculate bank height to fill river up to the banks
          const bankHeight = getTerrainHeight(riverX + RIVER_WIDTH, wz);
          this.W[x + z * this.size] = Math.max(0, bankHeight - 0.5 - h);
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
          const h = getTerrainHeight(wx, wz);
          newT_base[idx] = h;
          newT[idx] = h;
          newVX[idx] = 0;
          newVZ[idx] = 0;
          
          const riverX = getRiverCenter(wz);
          if (Math.abs(wx - riverX) < RIVER_WIDTH) {
            const bankHeight = getTerrainHeight(riverX + RIVER_WIDTH, wz);
            newW[idx] = Math.max(0, bankHeight - 0.5 - h);
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
    const newT = new Float32Array(this.size * this.size);
    
    // Re-evaluate base terrain including offsets
    for (let i = 0; i < this.size * this.size; i++) {
      const x = i % this.size;
      const z = Math.floor(i / this.size);
      const wx = this.originX - WATER_HALF + x;
      const wz = this.originZ - WATER_HALF + z;
      newT[i] = getTerrainHeight(wx, wz);
    }
    
    for (const block of blocks) {
      const bx = block.position[0];
      const by = block.position[1];
      const bz = block.position[2];
      
      if (block.type === 'mud') {
        const cx = Math.floor(bx) - this.originX + WATER_HALF;
        const cz = Math.floor(bz) - this.originZ + WATER_HALF;
        if (cx >= 0 && cx < this.size && cz >= 0 && cz < this.size) {
          newT[cx + cz * this.size] = Math.max(newT[cx + cz * this.size], by + 0.25);
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
              newT[x + z * this.size] = Math.max(newT[x + z * this.size], by + 0.4);
            }
          }
        }
      }
    }

    // Add draggable logs as obstacles
    for (const log of draggableLogs) {
      if (log.isDragged) continue; // Don't block water while being dragged
      
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
          
          if (dist < 1.4) { // Log radius is ~1.12, use 1.4 for solid wall
            newT[x + z * this.size] = Math.max(newT[x + z * this.size], by + 1.12);
          }
        }
      }
    }

    // Apply new terrain and displace water (prevents "slime" effect)
    for (let i = 0; i < this.size * this.size; i++) {
      const diff = newT[i] - this.T[i];
      if (diff > 0) {
        this.W[i] = Math.max(0, this.W[i] - diff);
      }
      this.T[i] = newT[i];
    }
  }

  simulate() {
    const K = 0.25; // Stable flow rate (max 0.25 for 2D grid to prevent oscillation)
    const outFlow = new Float32Array(this.size * this.size * 4);
    
    for (let x = 1; x < this.size - 1; x++) {
      for (let z = 1; z < this.size - 1; z++) {
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
          outFlow[outIdx] = dhT * scale;
          outFlow[outIdx + 1] = dhR * scale;
          outFlow[outIdx + 2] = dhB * scale;
          outFlow[outIdx + 3] = dhL * scale;
        }
      }
    }
    
    this.VX.fill(0);
    this.VZ.fill(0);
    
    for (let x = 1; x < this.size - 1; x++) {
      for (let z = 1; z < this.size - 1; z++) {
        const idx = x + z * this.size;
        const outIdx = idx * 4;
        
        const outT = outFlow[outIdx];
        const outR = outFlow[outIdx + 1];
        const outB = outFlow[outIdx + 2];
        const outL = outFlow[outIdx + 3];
        
        const inT = outFlow[(x + (z - 1) * this.size) * 4 + 2];
        const inR = outFlow[((x + 1) + z * this.size) * 4 + 3];
        const inB = outFlow[(x + (z + 1) * this.size) * 4 + 0];
        const inL = outFlow[((x - 1) + z * this.size) * 4 + 1];
        
        this.W[idx] += (inT + inR + inB + inL) - (outT + outR + outB + outL);
        if (this.W[idx] < 0) this.W[idx] = 0;
        
        if (this.W[idx] > 0.01) {
          this.VX[idx] = (inL + outR - outL - inR) * 10; 
          this.VZ[idx] = (inT + outB - outT - inB) * 10;
        }
      }
    }
    
    // Source and Sink
    for (let x = 0; x < this.size; x++) {
      const wx = this.originX - WATER_HALF + x;
      
      // Upstream Source
      const sourceZ = 1;
      const globalSourceZ = this.originZ - WATER_HALF + sourceZ;
      const riverX = getRiverCenter(globalSourceZ);
      
      // Only inject water if we are below the snowline (Z > -140)
      if (globalSourceZ > -140 && Math.abs(wx - riverX) < RIVER_WIDTH) {
        const idx = x + sourceZ * this.size;
        this.W[idx] += 0.12; // Inject water (decreased by 20% from 0.15)
        if (this.W[idx] > 10.0) this.W[idx] = 10.0; 
      }
      
      // Downstream Sink
      const sinkZ1 = this.size - 2;
      const sinkZ2 = this.size - 1;
      this.W[x + sinkZ1 * this.size] *= 0.8;
      this.W[x + sinkZ2 * this.size] = 0;
    }

    // East/West Sinks (to drain rain water that flows off the sides)
    for (let z = 0; z < this.size; z++) {
      this.W[0 + z * this.size] = 0;
      this.W[this.size - 1 + z * this.size] = 0;
    }

    // Ground absorption & Ocean fill
    const SEA_LEVEL = -15;
    for (let i = 0; i < this.size * this.size; i++) {
      const terrainH = this.T[i];
      
      // Ocean fill
      if (terrainH < SEA_LEVEL) {
        const targetW = SEA_LEVEL - terrainH;
        if (this.W[i] < targetW) {
          this.W[i] += (targetW - this.W[i]) * 0.05; // Fill up to sea level
        }
      } else if (this.W[i] > 0) {
        // Ground absorption (slowly drains rain pools)
        this.W[i] = Math.max(0, this.W[i] - 0.0001);
      }
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
