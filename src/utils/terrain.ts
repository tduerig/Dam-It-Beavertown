import { createNoise2D } from 'simplex-noise';
import { getInterpolatedOffset } from './terrainOffsets';
import { globalTerrainConfig } from './terrainConfig';
import { floraCache, TreeItem } from './floraCache';

const noise2D = createNoise2D();

export const CHUNK_SIZE = 40;
// Keep RIVER_WIDTH export as alias for downstream consumers temporarily, but make getter-based if needed, or just let them read from config.
// Better: just export RIVER_WIDTH = () => globalTerrainConfig.riverWidth if we need to deprecate it. Let's just update `terrain.ts` and downstream consumers. But wait, downstream consumers use RIVER_WIDTH as a variable.
// I will just export a getter for RIVER_WIDTH for smooth refactoring.
export const getRiverWidth = () => globalTerrainConfig.riverWidth;

// Need to safely maintain backwards compatibility. Actually I'll just keep `export const RIVER_WIDTH = 8` for the chunks/components that just need a rough guess, but internally use `globalTerrainConfig` for everything.
export const RIVER_WIDTH = 8; // Legacy export for minor uses. Real width is in globalTerrainConfig.
export const SLOPE = 0.1; // Downhill towards +Z

export function getRiverCenter(z: number): number {
  return noise2D(z * globalTerrainConfig.twistFrequency, 0) * globalTerrainConfig.twistAmplitude; // Meandering river
}

export function getBaseTerrainHeight(x: number, z: number): number {
  let height = noise2D(x * 0.05, z * 0.05) * 5;
  height += noise2D(x * 0.1, z * 0.1) * 2;
  
  const riverX = getRiverCenter(z);
  const distFromRiver = Math.abs(x - riverX);
  
  if (distFromRiver < globalTerrainConfig.riverWidth) {
    const t = distFromRiver / globalTerrainConfig.riverWidth;
    const riverBedHeight = -globalTerrainConfig.riverDepth + noise2D(x * 0.2, z * 0.2);
    height = riverBedHeight * (1 - t) + height * t;
  } else {
    height += Math.max(0, 5 - (distFromRiver - globalTerrainConfig.riverWidth) * 0.5);
  }

  // Apply global slope
  height -= z * globalTerrainConfig.slope;

  // Add mountains on the sides (Humboldt style)
  if (x > 60) {
    height += (x - 60) * 0.4;
  } else if (x < -60) {
    height += (-60 - x) * 0.4;
  }

  return height;
}

export function getTerrainHeight(x: number, z: number): number {
  return globalTerrainCache.getHeight(x, z);
}

export function worldToChunkKey(x: number, z: number): string {
  return `${Math.floor(x / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
}
const generatedChunks = new Set<string>();

export function clearGeneratedTerrain() {
  generatedChunks.clear();
  globalTerrainCache.clear();
}

export function generateTreesForChunk(chunkX: number, chunkZ: number) {
  const cacheKey = `${chunkX},${chunkZ}`;
  
  if (generatedChunks.has(cacheKey)) {
      return floraCache.get(cacheKey);
  }
  generatedChunks.add(cacheKey);

  const flora: import('./floraCache').FloraItem[] = [];
  const offsetX = chunkX * CHUNK_SIZE;
  const offsetZ = chunkZ * CHUNK_SIZE;
  
  // Decreased density by 60% (from 80 to 32)
  for (let i = 0; i < 32; i++) {
    // Use noise to get deterministic random-like values between 0 and 1
    const rx = (noise2D(chunkX + i * 0.1, chunkZ) + 1) / 2;
    const rz = (noise2D(chunkX, chunkZ + i * 0.1) + 1) / 2;
    
    const x = offsetX + (rx - 0.5) * CHUNK_SIZE;
    const z = offsetZ + (rz - 0.5) * CHUNK_SIZE;
    
    const riverX = getRiverCenter(z);
    if (Math.abs(x - riverX) > globalTerrainConfig.riverWidth + 2) {
      const y = getTerrainHeight(x, z);
      
      const bankH = getTerrainHeight(riverX + globalTerrainConfig.riverWidth, z);
      const waterLevel = bankH - 0.3;
      
      // Sweet spot for trees: not too high (snowy), not too low (sandy beach), and strictly not flooded!
      if (y > -2 && y < 12 && y > waterLevel + 0.5) {
        const isBig = noise2D(chunkX + i * 0.2, chunkZ + i * 0.2) > 0.6;
        // Prevent overlapping canopies: reject if too close to an existing tree
        const minDist = isBig ? 7 : 4; // big trees need more clearance
        const tooClose = flora.some(f =>
          (f.type === 'big' || f.type === 'small') &&
          Math.sqrt((f.position[0] - x) ** 2 + (f.position[2] - z) ** 2) < minDist
        );
        if (!tooClose) {
          flora.push({ 
            id: `tree_${chunkX}_${chunkZ}_${i}`, 
            position: [x, y, z] as [number, number, number],
            type: isBig ? 'big' : 'small'
          });
        }
      }
    }
  }

  // Pre-populate aquatic flora along the river
  const rw = globalTerrainConfig.riverWidth;
  for (let i = 0; i < 20; i++) {
    // Large stride to prevent Perlin noise clustering
    const rx = (noise2D(chunkZ + i * 13.37, chunkX + 7) + 1) / 2; 
    const rz = (noise2D(chunkZ + 7, chunkX + i * 13.37) + 1) / 2;
    const x = offsetX + (rx - 0.5) * CHUNK_SIZE;
    const z = offsetZ + (rz - 0.5) * CHUNK_SIZE;
    
    const riverX = getRiverCenter(z);
    const distFromCenter = Math.abs(x - riverX);
    
    if (distFromCenter < rw) {
      // Use the water surface height for Y positioning
      const bankH = getTerrainHeight(riverX + rw, z);
      const waterLevel = bankH - 0.3;

      // Cattails: on the bank edges (outer 30% of river width)
      if (distFromCenter > rw * 0.7) {
        flora.push({
          id: `init_cat_${chunkX}_${chunkZ}_${i}`,
          position: [x, waterLevel, z] as [number, number, number],
          type: 'cattail'
        });
      }
      // Lilies: in the inner 70% of the river
      else if (noise2D(x * 0.5, z * 0.5) > 0.0) {
        flora.push({
          id: `init_lily_${chunkX}_${chunkZ}_${i}`,
          position: [x, waterLevel, z] as [number, number, number],
          type: 'lily'
        });
      }
    }
  }
  
  floraCache.set(cacheKey, flora);
  return flora;
}

class TerrainCache {
    private chunks = new Map<string, Float32Array>();

    public clear() {
        this.chunks.clear();
    }

    private getChunkKey(cx: number, cz: number): string {
        return `${cx}_${cz}`;
    }

    public getChunk(cx: number, cz: number): Float32Array {
        const key = this.getChunkKey(cx, cz);
        if (this.chunks.has(key)) return this.chunks.get(key)!;

        // 41x41 nodes to hold smooth boundary vertices seamlessly
        const size = CHUNK_SIZE + 1;
        const buffer = new Float32Array(size * size);

        const worldStartX = cx * CHUNK_SIZE;
        const worldStartZ = cz * CHUNK_SIZE;

        for (let x = 0; x < size; x++) {
            for (let z = 0; z < size; z++) {
                const wx = worldStartX + x;
                const wz = worldStartZ + z;
                
                let h = getBaseTerrainHeight(wx, wz);
                const offset = getInterpolatedOffset(wx, wz); // Fold established history perfectly
                
                buffer[x + z * size] = h + offset;
            }
        }
        
        this.chunks.set(key, buffer);
        return buffer;
    }

    public getHeight(x: number, z: number): number {
        const x0 = Math.floor(x);
        const z0 = Math.floor(z);
        const tx = x - x0;
        const tz = z - z0;

        const h00 = this.getNearestVertex(x0, z0);
        const h10 = this.getNearestVertex(x0 + 1, z0);
        const h01 = this.getNearestVertex(x0, z0 + 1);
        const h11 = this.getNearestVertex(x0 + 1, z0 + 1);

        const nx0 = h00 * (1 - tx) + h10 * tx;
        const nx1 = h01 * (1 - tx) + h11 * tx;
        return nx0 * (1 - tz) + nx1 * tz;
    }

    private getNearestVertex(wx: number, wz: number): number {
        const cx = Math.floor(wx / CHUNK_SIZE);
        const cz = Math.floor(wz / CHUNK_SIZE);
        
        let lx = wx - (cx * CHUNK_SIZE);
        let lz = wz - (cz * CHUNK_SIZE);
        
        if (lx < 0) lx = 0;
        if (lz < 0) lz = 0;
        if (lx > CHUNK_SIZE) lx = CHUNK_SIZE;
        if (lz > CHUNK_SIZE) lz = CHUNK_SIZE;

        const buffer = this.getChunk(cx, cz);
        return buffer[lx + lz * (CHUNK_SIZE + 1)];
    }

    public modifyHeight(wx: number, wz: number, delta: number) {
        const x0 = Math.floor(wx);
        const z0 = Math.floor(wz);
        
        const cx = Math.floor(x0 / CHUNK_SIZE);
        const cz = Math.floor(z0 / CHUNK_SIZE);
        const buffer = this.getChunk(cx, cz);
        
        const lx = x0 - (cx * CHUNK_SIZE);
        const lz = z0 - (cz * CHUNK_SIZE);
        
        const idx = lx + lz * (CHUNK_SIZE + 1);
        if (buffer[idx] !== undefined) buffer[idx] += delta;

        // Sync seamless chunk boundaries natively
        if (lx === 0) this.syncBorder(x0, z0, delta, cx - 1, cz, CHUNK_SIZE, lz);
        if (lz === 0) this.syncBorder(x0, z0, delta, cx, cz - 1, lx, CHUNK_SIZE);
        if (lx === CHUNK_SIZE) this.syncBorder(x0, z0, delta, cx + 1, cz, 0, lz);
        if (lz === CHUNK_SIZE) this.syncBorder(x0, z0, delta, cx, cz + 1, lx, 0);
    }
    
    private syncBorder(wx: number, wz: number, delta: number, cx: number, cz: number, lx: number, lz: number) {
        const key = this.getChunkKey(cx, cz);
        if (this.chunks.has(key)) {
            this.chunks.get(key)![lx + lz * (CHUNK_SIZE + 1)] += delta;
        }
    }
}

export const globalTerrainCache = new TerrainCache();
