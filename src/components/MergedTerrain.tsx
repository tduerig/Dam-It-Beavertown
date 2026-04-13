import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CHUNK_SIZE, getTerrainHeight, getBaseTerrainHeight } from '../utils/terrain';
import { useGameStore } from '../store';
import { isChunkTerrainDirty, getGlobalStamp } from '../utils/terrainOffsets';
import { getMudLevel, isMudChunkDirty, getMudGlobalStamp } from '../utils/mudEngine';
import { getRenderConfig } from '../utils/qualityTier';

// Hoisted Color objects (same as Chunk.tsx — avoids per-vertex allocation)
const _color = new THREE.Color();
const _mudColor = new THREE.Color('#4a3018');
const _snowColor = new THREE.Color('#ffffff');
const _rockColor = new THREE.Color('#888888');
const _forestColor = new THREE.Color('#4a5d23');
const _sandColor = new THREE.Color('#e6d59d');

const VERTS_PER_SIDE = 41; // 40 segments + 1
const VERTS_PER_CHUNK = VERTS_PER_SIDE * VERTS_PER_SIDE;
const TRIS_PER_CHUNK = 40 * 40 * 2;

// Create a single static template to guarantee identical vertex ordering and triangle 
// winding/diagonals as the old Chunk.tsx PlaneGeometry.
const _chunkTemplate = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, 40, 40);
_chunkTemplate.rotateX(-Math.PI / 2);
const _templatePos = _chunkTemplate.attributes.position.array;
const _templateIdx = _chunkTemplate.index!.array;

/**
 * Fill a subsection of the merged position/color buffers for one chunk
 * using the static template to guarantee exact vertex matching.
 */
function fillChunkVertices(
  pos: Float32Array,
  colors: Float32Array,
  vertexOffset: number,
  chunkX: number,
  chunkZ: number
) {
  const worldOffsetX = chunkX * CHUNK_SIZE;
  const worldOffsetZ = chunkZ * CHUNK_SIZE;

  for (let i = 0; i < _templatePos.length; i += 3) {
    const vi = vertexOffset + i;
    
    // World position (template is centered at 0,0,0)
    const wx = _templatePos[i] + worldOffsetX;
    const wz = _templatePos[i + 2] + worldOffsetZ;
    const y = getTerrainHeight(wx, wz);
    const baseY = getBaseTerrainHeight(wx, wz);
    const offset = y - baseY;

    pos[vi]     = wx;
    pos[vi + 1] = y;
    pos[vi + 2] = wz;

    // Biome colors
    if (y > 14) {
      _color.copy(_snowColor);
    } else if (y > 10) {
      _color.copy(_rockColor).lerp(_snowColor, (y - 10) / 4);
    } else if (y > 0) {
      _color.copy(_forestColor).lerp(_rockColor, y / 10);
    } else if (y > -4) {
      _color.copy(_sandColor).lerp(_forestColor, (y + 4) / 4);
    } else {
      _color.copy(_sandColor);
    }

    const mudSat = getMudLevel(wx, wz);
    if (Math.abs(offset) > 0.05 || mudSat > 0.05) {
      const offsetBlend = Math.abs(offset) > 0.05 ? Math.min(1, Math.abs(offset) / 0.8) : 0;
      const blend = Math.max(offsetBlend, mudSat);
      _color.lerp(_mudColor, blend);
    }

    colors[vi]     = _color.r;
    colors[vi + 1] = _color.g;
    colors[vi + 2] = _color.b;
  }
}

/**
 * Build the index buffer for one chunk grid using the template indices.
 */
function fillChunkIndices(
  indices: Uint32Array,
  indexOffset: number,
  vertexBase: number
) {
  for (let i = 0; i < _templateIdx.length; i++) {
    indices[indexOffset + i] = vertexBase + _templateIdx[i];
  }
}


export function MergedTerrain() {
  const meshRef = useRef<THREE.Mesh>(null);
  const geoRef = useRef<THREE.BufferGeometry>(null);

  // Track which chunks are loaded and their slot indices
  const chunkMapRef = useRef<Map<string, number>>(new Map());
  const lastChunkCoordsRef = useRef('');

  // Per-chunk dirty stamps
  const terrainStampsRef = useRef<Map<string, number>>(new Map());
  const mudStampsRef = useRef<Map<string, number>>(new Map());

  const viewDistance = getRenderConfig().chunkViewDistance;
  const totalChunks = (viewDistance * 2 + 1) ** 2; // e.g. 25 for viewDistance=2

  // Pre-allocate the merged geometry buffers — sized for max chunks
  const { positions, colors, indices } = useMemo(() => {
    const positions = new Float32Array(totalChunks * VERTS_PER_CHUNK * 3);
    const colors = new Float32Array(totalChunks * VERTS_PER_CHUNK * 3);
    const indices = new Uint32Array(totalChunks * TRIS_PER_CHUNK * 3);
    return { positions, colors, indices };
  }, [totalChunks]);

  // Build initial geometry structure
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }, [positions, colors, indices]);

  useFrame(() => {
    const state = useGameStore.getState();
    if (state.gameState !== 'playing' && state.gameState !== 'paused') return;

    const cx = Math.floor(state.playerPosition[0] / CHUNK_SIZE);
    const cz = Math.floor(state.playerPosition[2] / CHUNK_SIZE);
    const coordsKey = `${cx},${cz}`;

    const chunkMap = chunkMapRef.current;
    const posAttr = geometry.attributes.position as THREE.BufferAttribute;
    const colAttr = geometry.attributes.color as THREE.BufferAttribute;
    let needsFullRebuild = false;

    // Detect if the player crossed a chunk boundary — need to rebuild the chunk set
    if (coordsKey !== lastChunkCoordsRef.current) {
      lastChunkCoordsRef.current = coordsKey;
      needsFullRebuild = true;

      // Build new chunk set and assign slots
      chunkMap.clear();
      terrainStampsRef.current.clear();
      mudStampsRef.current.clear();

      let slot = 0;
      for (let dx = -viewDistance; dx <= viewDistance; dx++) {
        for (let dz = -viewDistance; dz <= viewDistance; dz++) {
          const key = `${cx + dx},${cz + dz}`;
          chunkMap.set(key, slot);
          terrainStampsRef.current.set(key, 0);
          mudStampsRef.current.set(key, 0);
          slot++;
        }
      }
    }

    // Check each chunk for dirtiness (or full rebuild)
    let anyDirty = false;
    for (const [key, slot] of chunkMap) {
      const [kcx, kcz] = key.split(',').map(Number);
      const lastTerrain = terrainStampsRef.current.get(key) || 0;
      const lastMud = mudStampsRef.current.get(key) || 0;

      const terrainDirty = needsFullRebuild || isChunkTerrainDirty(kcx, kcz, lastTerrain);
      const mudDirty = !needsFullRebuild && isMudChunkDirty(kcx, kcz, lastMud);

      if (terrainDirty || mudDirty) {
        const vOffset = slot * VERTS_PER_CHUNK * 3;
        fillChunkVertices(posAttr.array as Float32Array, colAttr.array as Float32Array, vOffset, kcx, kcz);

        if (needsFullRebuild) {
          fillChunkIndices(geometry.index!.array as Uint32Array, slot * TRIS_PER_CHUNK * 3, slot * VERTS_PER_CHUNK);
        }

        terrainStampsRef.current.set(key, getGlobalStamp());
        mudStampsRef.current.set(key, getMudGlobalStamp());
        anyDirty = true;
      }
    }

    if (anyDirty) {
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      if (needsFullRebuild) {
        geometry.index!.needsUpdate = true;
      }
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
    }
  });

  return (
    <mesh ref={meshRef} geometry={geometry} receiveShadow>
      <meshStandardMaterial vertexColors={true} roughness={0.8} metalness={0.1} />
    </mesh>
  );
}
