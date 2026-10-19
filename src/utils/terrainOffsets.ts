/**
 * Terrain Offset Engine
 * 
 * Manages terrain modification data OUTSIDE of Zustand to avoid:
 * 1. O(N) shallow-copy on every modification (AP-2)
 * 2. Broadcast invalidation to all 49 chunks (AP-3)
 * 3. Per-vertex getState() calls in getTerrainHeight (82,369 calls per modification)
 * 
 * Instead, we use a plain Map<string, number> and a per-chunk dirty notification system.
 */

import { CHUNK_SIZE, globalTerrainCache } from './terrain';

// ── Core data store ──────────────────────────────────────────
// The actual terrain offset data. Module-scope, not reactive.
// Uses 32-bit integer keys ((x + 32768) << 16) | ((z + 32768) & 0xFFFF) for zero-allocation hot lookups.
const _offsets = new Map<number, number>();
let _updateFlag = 0;

// ── Chunk dirty tracking ─────────────────────────────────────
// Maps packed chunk key → last modification stamp.
// Chunks poll this to decide if they need to rebuild geometry.
const _chunkDirtyStamps = new Map<number, number>();
let _globalStamp = 0;
let _resetStamp = 0;

export function packCoord(x: number, z: number): number {
  return ((x + 32768) << 16) | ((z + 32768) & 0xffff);
}

export function unpackCoord(packed: number): [number, number] {
  const x = (packed >>> 16) - 32768;
  const z = (packed & 0xffff) - 32768;
  return [x, z];
}

/**
 * Get the terrain offset at integer coordinates (x, z) using zero-allocation packed int key.
 */
export function getOffsetXY(x: number, z: number): number {
  return _offsets.get(((x + 32768) << 16) | ((z + 32768) & 0xffff)) || 0;
}

/**
 * Legacy string-keyed getter for backwards compatibility with existing tests.
 */
export function getOffset(key: string): number {
  const comma = key.indexOf(',');
  const x = parseInt(key.slice(0, comma), 10);
  const z = parseInt(key.slice(comma + 1), 10);
  return _offsets.get(((x + 32768) << 16) | ((z + 32768) & 0xffff)) || 0;
}

/** Get the update flag (for WaterEngine cache invalidation) */
export function getUpdateFlag(): number {
  return _updateFlag;
}

/** Check if any offsets exist (for fast-path skipping) */
export function hasAnyOffsets(): boolean {
  return _offsets.size > 0;
}

/**
 * Apply a terrain modification.
 * Returns the number of cells modified (for stats).
 * Computes which chunks are affected and marks only those dirty.
 */
export function applyTerrainMod(
  cx: number, cz: number, amount: number, radius: number
): void {
  const minX = Math.floor(cx - radius);
  const maxX = Math.ceil(cx + radius);
  const minZ = Math.floor(cz - radius);
  const maxZ = Math.ceil(cz + radius);
  const r4 = radius * radius * radius * radius;
  
  for (let x = minX; x <= maxX; x++) {
    const dx = x - cx;
    const dx2 = dx * dx;
    const dx4 = dx2 * dx2;
    for (let z = minZ; z <= maxZ; z++) {
      const dz = z - cz;
      const dz2 = dz * dz;
      const dist4 = dx4 + dz2 * dz2;
      
      if (dist4 <= r4) {
        const key = ((x + 32768) << 16) | ((z + 32768) & 0xffff);
        const current = _offsets.get(key) || 0;
        const falloff = 1 - dist4 / r4;
        const delta = amount * falloff;
        _offsets.set(key, current + delta);
        globalTerrainCache.modifyHeight(x, z, delta);
      }
    }
  }
  
  _updateFlag = Date.now();
  _globalStamp++;
  
  // Mark overlapping chunks dirty (Chunks are center-aligned, so offset by CHUNK_SIZE/2)
  // Expand bounds slightly to ensure shared chunk edges are invalidated correctly.
  const chunkMinX = Math.floor((minX + CHUNK_SIZE / 2 - 1) / CHUNK_SIZE);
  const chunkMaxX = Math.floor((maxX + CHUNK_SIZE / 2 + 1) / CHUNK_SIZE);
  const chunkMinZ = Math.floor((minZ + CHUNK_SIZE / 2 - 1) / CHUNK_SIZE);
  const chunkMaxZ = Math.floor((maxZ + CHUNK_SIZE / 2 + 1) / CHUNK_SIZE);
  
  for (let cx2 = chunkMinX; cx2 <= chunkMaxX; cx2++) {
    for (let cz2 = chunkMinZ; cz2 <= chunkMaxZ; cz2++) {
      _chunkDirtyStamps.set(((cx2 + 32768) << 16) | ((cz2 + 32768) & 0xffff), _globalStamp);
    }
  }
}

/**
 * Apply a batch of terrain modifications (used by leaf decay).
 */
export function applyTerrainBatch(
  modifications: Array<{x: number, z: number, amount: number, radius: number}>
): void {
  if (modifications.length === 0) return;
  
  let globalMinX = Infinity, globalMaxX = -Infinity;
  let globalMinZ = Infinity, globalMaxZ = -Infinity;
  
  for (const mod of modifications) {
    const { x: cx, z: cz, amount, radius } = mod;
    const minX = Math.floor(cx - radius);
    const maxX = Math.ceil(cx + radius);
    const minZ = Math.floor(cz - radius);
    const maxZ = Math.ceil(cz + radius);
    const r4 = radius * radius * radius * radius;
    
    globalMinX = Math.min(globalMinX, minX);
    globalMaxX = Math.max(globalMaxX, maxX);
    globalMinZ = Math.min(globalMinZ, minZ);
    globalMaxZ = Math.max(globalMaxZ, maxZ);
    
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dx2 = dx * dx;
      const dx4 = dx2 * dx2;
      for (let z = minZ; z <= maxZ; z++) {
        const dz = z - cz;
        const dz2 = dz * dz;
        const dist4 = dx4 + dz2 * dz2;
        
        if (dist4 <= r4) {
          const key = ((x + 32768) << 16) | ((z + 32768) & 0xffff);
          const current = _offsets.get(key) || 0;
          const falloff = 1 - dist4 / r4;
          const delta = amount * falloff;
          _offsets.set(key, current + delta);
          globalTerrainCache.modifyHeight(x, z, delta);
        }
      }
    }
  }
  
  _updateFlag = Date.now();
  _globalStamp++;
  
  // Mark overlapping chunks dirty (Chunks are center-aligned, so offset by CHUNK_SIZE/2)
  // Expand bounds slightly to ensure shared chunk edges are invalidated correctly.
  const chunkMinX = Math.floor((globalMinX + CHUNK_SIZE / 2 - 1) / CHUNK_SIZE);
  const chunkMaxX = Math.floor((globalMaxX + CHUNK_SIZE / 2 + 1) / CHUNK_SIZE);
  const chunkMinZ = Math.floor((globalMinZ + CHUNK_SIZE / 2 - 1) / CHUNK_SIZE);
  const chunkMaxZ = Math.floor((globalMaxZ + CHUNK_SIZE / 2 + 1) / CHUNK_SIZE);
  
  for (let cx2 = chunkMinX; cx2 <= chunkMaxX; cx2++) {
    for (let cz2 = chunkMinZ; cz2 <= chunkMaxZ; cz2++) {
      _chunkDirtyStamps.set(((cx2 + 32768) << 16) | ((cz2 + 32768) & 0xffff), _globalStamp);
    }
  }
}

/**
 * Check if a chunk's terrain geometry is dirty (needs rebuild).
 * The chunk passes its own last-seen stamp; if the global stamp
 * for that chunk is newer, the chunk needs to rebuild.
 */
export function isChunkTerrainDirty(chunkX: number, chunkZ: number, lastSeenStamp: number): boolean {
  const key = ((chunkX + 32768) << 16) | ((chunkZ + 32768) & 0xffff);
  const chunkStamp = _chunkDirtyStamps.get(key) || 0;
  return Math.max(_resetStamp, chunkStamp) > lastSeenStamp;
}

/** Get the current global stamp. */
export function getGlobalStamp(): number {
  return _globalStamp;
}

/**
 * Export all offsets as a plain object (for save/load serialization).
 */
export function serializeOffsets(): Record<string, number> {
  const obj: Record<string, number> = {};
  for (const [packed, val] of _offsets) {
    const [x, z] = unpackCoord(packed);
    obj[`${x},${z}`] = val;
  }
  return obj;
}

/**
 * Import offsets from a plain object (for save/load deserialization).
 */
export function deserializeOffsets(data: Record<string, number>): void {
  _offsets.clear();
  _chunkDirtyStamps.clear();
  for (const [key, val] of Object.entries(data)) {
    if (key !== 'update_flag') {
      const comma = key.indexOf(',');
      if (comma !== -1) {
        const x = parseInt(key.slice(0, comma), 10);
        const z = parseInt(key.slice(comma + 1), 10);
        _offsets.set(((x + 32768) << 16) | ((z + 32768) & 0xffff), val);
      }
    }
  }
  globalTerrainCache.clear();
  _updateFlag = Date.now();
  _globalStamp++;
  _resetStamp = _globalStamp;
}

/**
 * Get interpolated terrain offset at a world position (bilinear interpolation).
 * This replaces the per-vertex getState() + dict lookup in getTerrainHeight.
 */
export function getInterpolatedOffset(x: number, z: number): number {
  if (_offsets.size === 0) return 0;
  
  const x0 = Math.floor(x);
  const x1 = x0 + 1;
  const z0 = Math.floor(z);
  const z1 = z0 + 1;
  
  const tx = x - x0;
  const tz = z - z0;
  
  const bx0 = (x0 + 32768) << 16;
  const bx1 = (x1 + 32768) << 16;
  const bz0 = (z0 + 32768) & 0xffff;
  const bz1 = (z1 + 32768) & 0xffff;

  const v00 = _offsets.get(bx0 | bz0) || 0;
  const v10 = _offsets.get(bx1 | bz0) || 0;
  const v01 = _offsets.get(bx0 | bz1) || 0;
  const v11 = _offsets.get(bx1 | bz1) || 0;
  
  const nx0 = v00 * (1 - tx) + v10 * tx;
  const nx1 = v01 * (1 - tx) + v11 * tx;
  
  return nx0 * (1 - tz) + nx1 * tz;
}
