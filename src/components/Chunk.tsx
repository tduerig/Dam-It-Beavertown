import { useMemo } from 'react';
import { generateTreesForChunk } from '../utils/terrain';

/**
 * Chunk — pure logical boundary layer.
 *
 * All visual rendering has been moved to global pooling components:
 * - Terrain → TerrainLODManager (merged LOD rings)
 * - Trees  → GlobalTrees (4 global InstancedMeshes)
 * - Aquatic flora → GlobalFlora
 *
 * Chunk exists to trigger tree & flora cache population via generateTreesForChunk().
 */
export function Chunk({ chunkX, chunkZ }: { chunkX: number, chunkZ: number }) {
  // Ensure tree cache is populated for this chunk (GlobalTrees & GlobalFlora read from floraCache)
  useMemo(() => {
    generateTreesForChunk(chunkX, chunkZ);
  }, [chunkX, chunkZ]);

  // Empty group — no meshes. Retained for logical identity + cache seeding.
  return null;
}
