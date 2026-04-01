import { createNoise2D } from 'simplex-noise';
import { useGameStore } from '../store';

const noise2D = createNoise2D();

export const CHUNK_SIZE = 40;
export const RIVER_WIDTH = 8;
export const RIVER_DEPTH = 3;
export const SLOPE = 0.1; // Downhill towards +Z

export function getRiverCenter(z: number): number {
  return noise2D(z * 0.01, 0) * 15; // Meandering river
}

export function getBaseTerrainHeight(x: number, z: number): number {
  let height = noise2D(x * 0.05, z * 0.05) * 5;
  height += noise2D(x * 0.1, z * 0.1) * 2;
  
  const riverX = getRiverCenter(z);
  const distFromRiver = Math.abs(x - riverX);
  
  if (distFromRiver < RIVER_WIDTH) {
    const t = distFromRiver / RIVER_WIDTH;
    const riverBedHeight = -RIVER_DEPTH + noise2D(x * 0.2, z * 0.2);
    height = riverBedHeight * (1 - t) + height * t;
  } else {
    height += Math.max(0, 5 - (distFromRiver - RIVER_WIDTH) * 0.5);
  }

  // Apply global slope
  height -= z * SLOPE;

  // Add mountains on the sides (Humboldt style)
  if (x > 60) {
    height += (x - 60) * 0.4;
  } else if (x < -60) {
    height += (-60 - x) * 0.4;
  }

  return height;
}

export function getTerrainHeight(x: number, z: number): number {
  const base = getBaseTerrainHeight(x, z);
  const offsets = useGameStore.getState().terrainOffsets;
  
  // Bilinear interpolation of integer grid offsets
  const x0 = Math.floor(x);
  const x1 = x0 + 1;
  const z0 = Math.floor(z);
  const z1 = z0 + 1;

  const tx = x - x0;
  const tz = z - z0;

  const v00 = offsets[`${x0},${z0}`] || 0;
  const v10 = offsets[`${x1},${z0}`] || 0;
  const v01 = offsets[`${x0},${z1}`] || 0;
  const v11 = offsets[`${x1},${z1}`] || 0;

  const nx0 = v00 * (1 - tx) + v10 * tx;
  const nx1 = v01 * (1 - tx) + v11 * tx;

  const offset = nx0 * (1 - tz) + nx1 * tz;

  return base + offset;
}



export function generateTreesForChunk(chunkX: number, chunkZ: number) {
  const trees = [];
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
    if (Math.abs(x - riverX) > RIVER_WIDTH + 2) {
      const y = getTerrainHeight(x, z);
      // Sweet spot for trees: not too high (snowy), not too low (sandy beach)
      if (y > -2 && y < 12) {
        const isBig = noise2D(chunkX + i * 0.2, chunkZ + i * 0.2) > 0.6;
        trees.push({ 
          id: `tree_${chunkX}_${chunkZ}_${i}`, 
          position: [x, y, z] as [number, number, number],
          type: isBig ? 'big' : 'small'
        });
      }
    }
  }
  return trees;
}
