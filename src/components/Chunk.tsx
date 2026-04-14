import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { CHUNK_SIZE, generateTreesForChunk } from '../utils/terrain';
import { isChunkTerrainDirty, getGlobalStamp } from '../utils/terrainOffsets';
import { isMudChunkDirty, getMudGlobalStamp } from '../utils/mudEngine';

/**
 * Chunk — pure logical boundary layer.
 *
 * All visual rendering has been moved to global pooling components:
 * - Terrain → MergedTerrain (single draw call for all chunks)
 * - Trees  → GlobalTrees (4 global InstancedMeshes)
 * - Aquatic flora → GlobalFlora
 *
 * Chunk still exists to:
 * 1. Trigger tree cache population via generateTreesForChunk().
 * 2. Drive terrain/mud dirty-polling that feeds MergedTerrain.
 */
export function Chunk({ chunkX, chunkZ }: { chunkX: number, chunkZ: number }) {
  const lastSeenStamp = useRef(0);
  const lastSeenMudStamp = useRef(0);
  
  // Poll for terrain/mud dirtiness. MergedTerrain reads the same stamps,
  // but Chunk is the authority that triggers generateTreesForChunk.
  useFrame(() => {
    if (isChunkTerrainDirty(chunkX, chunkZ, lastSeenStamp.current)) {
      lastSeenStamp.current = getGlobalStamp();
    } else if (isMudChunkDirty(chunkX, chunkZ, lastSeenMudStamp.current)) {
      lastSeenMudStamp.current = getMudGlobalStamp();
    }
  });

  // Ensure tree cache is populated for this chunk (GlobalTrees reads from floraCache)
  useMemo(() => {
    generateTreesForChunk(chunkX, chunkZ);
  }, [chunkX, chunkZ]);

  // Empty group — no meshes. Retained for logical identity + cache seeding.
  return null;
}
