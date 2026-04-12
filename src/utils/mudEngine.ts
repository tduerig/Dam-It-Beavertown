/**
 * Mud Saturation Engine
 *
 * Tracks where water has created gatherable mud on eligible terrain.
 * Uses the same sparse Map pattern as terrainOffsets to avoid per-frame
 * overhead and unnecessary GC pressure.
 *
 * Design principles:
 * - Initial river banks are implicitly pre-saturated (no map entry needed)
 * - Only cells that get DUG or that receive DYNAMIC flooding need tracking
 * - Update frequency: 1Hz, piggybacked on WaterEngine tick
 * - Biome exclusion: no mud on sand (baseHeight <= -2) or snow/rock (baseHeight >= 10)
 */

import { CHUNK_SIZE, getBaseTerrainHeight, getRiverCenter } from './terrain';
import { globalTerrainConfig } from './terrainConfig';

// ── Core data store ──────────────────────────────────────────────
// "x,z" → saturation level (0.0 = depleted, 1.0+ = fully saturated/gatherable)
const _mudSaturation = new Map<string, number>();

// Chunk dirty tracking — mirrors terrainOffsets pattern
const _mudChunkStamps = new Map<string, number>();
let _mudGlobalStamp = 0;
let _lastUpdateTime = 0;

// ── Constants ────────────────────────────────────────────────────
const MUD_MIN_HEIGHT = -2;   // Below this = sand, no mud
const MUD_MAX_HEIGHT = 10;   // Above this = rock/snow, no mud
const GATHER_THRESHOLD = 1.0;
// Saturation increments per 1Hz tick:
const SAT_RATE_SUBMERGED = 1.0;   // 1 tick  = 1s to fully saturate
const SAT_RATE_SHORELINE = 0.5;   // 2 ticks = 2s to fully saturate
const WATER_DEPTH_SUBMERGED = 0.3; // W > 0.3 = "submerged", otherwise "shoreline"

/**
 * Check if a world-space coordinate is in a biome eligible for mud formation.
 */
function isBiomeEligible(baseHeight: number): boolean {
  return baseHeight > MUD_MIN_HEIGHT && baseHeight < MUD_MAX_HEIGHT;
}

/**
 * Check if a coordinate is on the initial (static) river bank.
 * These cells are pre-saturated — always gatherable until dug.
 */
function isStaticRiverBank(wx: number, wz: number): boolean {
  const riverX = getRiverCenter(wz);
  const dist = Math.abs(wx - riverX);
  // Bank zone: from the river edge out to +3 units beyond the river width
  return dist < globalTerrainConfig.riverWidth + 3;
}

function coordKey(x: number, z: number): string {
  return `${Math.floor(x)},${Math.floor(z)}`;
}

function chunkKeyFromWorld(wx: number, wz: number): string {
  const cx = Math.floor((wx + CHUNK_SIZE / 2) / CHUNK_SIZE);
  const cz = Math.floor((wz + CHUNK_SIZE / 2) / CHUNK_SIZE);
  return `${cx},${cz}`;
}

function markChunkDirty(wx: number, wz: number): void {
  // Mark the containing chunk and its immediate neighbors dirty
  // (mud on chunk boundaries affects adjacent chunk vertex colors)
  const cx = Math.floor((wx + CHUNK_SIZE / 2) / CHUNK_SIZE);
  const cz = Math.floor((wz + CHUNK_SIZE / 2) / CHUNK_SIZE);
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      _mudChunkStamps.set(`${cx + dx},${cz + dz}`, _mudGlobalStamp);
    }
  }
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Update mud saturation based on current water state.
 * Called at ~1Hz from WaterEngine.update().
 *
 * Iterates ONLY the wet cells in the water grid — dry cells are skipped.
 * For each wet cell in an eligible biome, increments saturation.
 * Submerged cells (deep water) saturate faster than shoreline cells.
 */
export function updateMudSaturation(
  W: Float32Array,
  T_base: Float32Array,
  size: number,
  originX: number,
  originZ: number,
  halfSize: number
): void {
  let anyChanged = false;
  const changedChunks = new Set<string>();

  for (let i = 0; i < size * size; i++) {
    const waterDepth = W[i];

    // Skip completely dry cells — this is the majority of the grid
    if (waterDepth <= 0.02) continue;

    const x = i % size;
    const z = Math.floor(i / size);
    const wx = originX - halfSize + x;
    const wz = originZ - halfSize + z;
    const baseH = T_base[i];

    // Biome gate: no mud on sand or snow
    if (!isBiomeEligible(baseH)) continue;

    const key = coordKey(wx, wz);
    const current = _mudSaturation.get(key);

    // If this cell has no entry and is on the static river bank, it's
    // already implicitly saturated — nothing to do.
    if (current === undefined && isStaticRiverBank(wx, wz)) continue;

    // Determine saturation rate based on water depth
    const rate = waterDepth > WATER_DEPTH_SUBMERGED
      ? SAT_RATE_SUBMERGED
      : SAT_RATE_SHORELINE;

    const prev = current ?? 0;
    if (prev >= GATHER_THRESHOLD) continue; // Already fully saturated

    const next = Math.min(GATHER_THRESHOLD, prev + rate);
    _mudSaturation.set(key, next);

    // Track visual change (crossed from non-visible to visible, or visible shift)
    if ((prev < 0.1 && next >= 0.1) || (prev < GATHER_THRESHOLD && next >= GATHER_THRESHOLD)) {
      anyChanged = true;
      changedChunks.add(chunkKeyFromWorld(wx, wz));
    }
  }

  if (anyChanged) {
    _mudGlobalStamp++;
    for (const ck of changedChunks) {
      _mudChunkStamps.set(ck, _mudGlobalStamp);
    }
  }
}

/**
 * Check if mud can be gathered at a world coordinate.
 */
export function canGatherMud(wx: number, wz: number): boolean {
  const baseH = getBaseTerrainHeight(wx, wz);
  if (!isBiomeEligible(baseH)) return false;

  const key = coordKey(wx, wz);
  const sat = _mudSaturation.get(key);

  if (sat !== undefined) {
    return sat >= GATHER_THRESHOLD;
  }

  // No explicit entry — check if it's on the pre-saturated static river bank
  return isStaticRiverBank(wx, wz);
}

/**
 * Deplete mud saturation at a coordinate (called when mud is gathered).
 */
export function gatherMud(wx: number, wz: number): void {
  const key = coordKey(wx, wz);
  _mudSaturation.set(key, 0);
  _mudGlobalStamp++;
  markChunkDirty(wx, wz);
}

/**
 * Get the mud saturation level at a coordinate for visual blending.
 * Returns 0.0 (no mud) to 1.0 (fully saturated).
 */
export function getMudLevel(wx: number, wz: number): number {
  const baseH = getBaseTerrainHeight(wx, wz);
  if (!isBiomeEligible(baseH)) return 0;

  const key = coordKey(wx, wz);
  const sat = _mudSaturation.get(key);

  if (sat !== undefined) {
    return Math.min(1, sat);
  }

  // Static river bank — implicitly fully saturated
  return isStaticRiverBank(wx, wz) ? 1.0 : 0.0;
}

/**
 * Check if a chunk's mud state has changed since the given stamp.
 */
export function isMudChunkDirty(chunkX: number, chunkZ: number, lastSeenStamp: number): boolean {
  const key = `${chunkX},${chunkZ}`;
  const chunkStamp = _mudChunkStamps.get(key) || 0;
  return chunkStamp > lastSeenStamp;
}

/** Get the current global mud stamp. */
export function getMudGlobalStamp(): number {
  return _mudGlobalStamp;
}

/**
 * Check if enough time has passed since the last update (1Hz throttle).
 * Returns true if an update should run.
 */
export function shouldUpdate(now: number): boolean {
  if (now - _lastUpdateTime >= 1000) {
    _lastUpdateTime = now;
    return true;
  }
  return false;
}

// ── Serialization ────────────────────────────────────────────────

export function serializeMud(): Record<string, number> {
  const obj: Record<string, number> = {};
  for (const [key, val] of _mudSaturation) {
    // Only serialize cells that differ from default (saves space)
    obj[key] = val;
  }
  return obj;
}

export function deserializeMud(data: Record<string, number>): void {
  _mudSaturation.clear();
  for (const [key, val] of Object.entries(data)) {
    _mudSaturation.set(key, val);
  }
  _mudGlobalStamp++;
}

export function clearMud(): void {
  _mudSaturation.clear();
  _mudChunkStamps.clear();
  _mudGlobalStamp++;
  _lastUpdateTime = 0;
}
