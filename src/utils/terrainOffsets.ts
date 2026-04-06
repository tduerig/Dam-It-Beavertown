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
const _offsets = new Map<string, number>();
let _updateFlag = 0;

// ── Chunk dirty tracking ─────────────────────────────────────
// Maps chunk key ("cx,cz") → last modification stamp.
// Chunks poll this to decide if they need to rebuild geometry.
const _chunkDirtyStamps = new Map<string, number>();
let _globalStamp = 0;

/**
 * Get the terrain offset at integer coordinates (x, z).
 * This is the hot-path function called by getTerrainHeight.
 * No Zustand, no getState(), no string template overhead.
 */
export function getOffset(key: string): number {
  return _offsets.get(key) || 0;
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
  
  for (let x = minX; x <= maxX; x++) {
    for (let z = minZ; z <= maxZ; z++) {
      const dx = Math.abs(x - cx);
      const dz = Math.abs(z - cz);
      const dist = Math.pow(Math.pow(dx, 4) + Math.pow(dz, 4), 0.25);
      
      if (dist <= radius) {
        const key = `${x},${z}`;
        const current = _offsets.get(key) || 0;
        const t = dist / radius;
        const falloff = 1 - Math.pow(t, 4);
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
      _chunkDirtyStamps.set(`${cx2},${cz2}`, _globalStamp);
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
    
    globalMinX = Math.min(globalMinX, minX);
    globalMaxX = Math.max(globalMaxX, maxX);
    globalMinZ = Math.min(globalMinZ, minZ);
    globalMaxZ = Math.max(globalMaxZ, maxZ);
    
    for (let x = minX; x <= maxX; x++) {
      for (let z = minZ; z <= maxZ; z++) {
        const dx = Math.abs(x - cx);
        const dz = Math.abs(z - cz);
        const dist = Math.pow(Math.pow(dx, 4) + Math.pow(dz, 4), 0.25);
        
        if (dist <= radius) {
          const key = `${x},${z}`;
          const current = _offsets.get(key) || 0;
          const t = dist / radius;
          const falloff = 1 - Math.pow(t, 4);
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
      _chunkDirtyStamps.set(`${cx2},${cz2}`, _globalStamp);
    }
  }
}

/**
 * Check if a chunk's terrain geometry is dirty (needs rebuild).
 * The chunk passes its own last-seen stamp; if the global stamp
 * for that chunk is newer, the chunk needs to rebuild.
 */
export function isChunkTerrainDirty(chunkX: number, chunkZ: number, lastSeenStamp: number): boolean {
  const key = `${chunkX},${chunkZ}`;
  const chunkStamp = _chunkDirtyStamps.get(key) || 0;
  return chunkStamp > lastSeenStamp;
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
  for (const [key, val] of _offsets) {
    obj[key] = val;
  }
  return obj;
}

/**
 * Import offsets from a plain object (for save/load deserialization).
 */
export function deserializeOffsets(data: Record<string, number>): void {
  _offsets.clear();
  for (const [key, val] of Object.entries(data)) {
    if (key !== 'update_flag') {
      _offsets.set(key, val);
      // We don't apply globalTerrainCache.modifyHeight here because the terrainCache
      // natively folds _offsets when a new chunk is lazily compiled.
    }
  }
  _updateFlag = Date.now();
  _globalStamp++;
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
  
  const v00 = _offsets.get(`${x0},${z0}`) || 0;
  const v10 = _offsets.get(`${x1},${z0}`) || 0;
  const v01 = _offsets.get(`${x0},${z1}`) || 0;
  const v11 = _offsets.get(`${x1},${z1}`) || 0;
  
  const nx0 = v00 * (1 - tx) + v10 * tx;
  const nx1 = v01 * (1 - tx) + v11 * tx;
  
  return nx0 * (1 - tz) + nx1 * tz;
}
