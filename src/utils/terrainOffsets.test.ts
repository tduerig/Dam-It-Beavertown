import { applyTerrainMod, isChunkTerrainDirty, getGlobalStamp } from './terrainOffsets';
import { CHUNK_SIZE } from './terrain';

describe('Terrain Offsets caching bug', () => {
  it('correctly marks chunks dirty when heavily misaligned (positive coords)', () => {
    // Current global stamp starts at 0
    const startStamp = getGlobalStamp();
    
    // Chunk 0 is bounded [0, CHUNK_SIZE] in world coordinates because Chunk geometry is built 0 to CHUNK_SIZE.
    // Wait, let's look at Chunk.tsx: wX = chunkX * CHUNK_SIZE + x.
    // If chunkX = 1, wX ranges from 40 to 80.
    // If we modify terrain at wX = 45, radius 2.
    // This entirely falls within Chunk 1.
    // Let's test modifying at wX = 58, radius 3. 
    // bounds: [55, 61].
    // Chunk 1 is 40..80. Chunk 2 is 80..120.
    // But mathematically, 55/40 = 1.375 -> floor(1.375) = 1.
    // 61/40 = 1.525 -> floor(1.525) = 1.
    // Actually, what if modifying at wX=39, radius 2?
    // bounds: [37, 41]. 
    // 37/40 = 0.925 -> floor = 0.
    // 41/40 = 1.025 -> floor = 1.
    // Chunks 0 and 1 should be dirty.

    applyTerrainMod(39, 10, 1, 2);

    expect(isChunkTerrainDirty(0, 0, startStamp)).toBe(true);
    expect(isChunkTerrainDirty(1, 0, startStamp)).toBe(true);
  });

  it('correctly marks chunk dirty when modifying negatively but inside chunk 0', () => {
    const startStamp = getGlobalStamp();
    
    // In our system, chunk 0 is [0, 40]. chunk -1 is [-40, 0].
    // If we modify at wX = -2, radius 1 -> bounds: [-3, -1].
    // chunk bounds: floor(-3/40) = -1, floor(-1/40) = -1. 
    // Chunk -1 should be dirty.
    applyTerrainMod(-2, -2, 1, 1);
    
    expect(isChunkTerrainDirty(-1, -1, startStamp)).toBe(true);
  });
});
