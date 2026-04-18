import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CHUNK_SIZE, getTerrainHeight, getBaseTerrainHeight } from '../utils/terrain';
import { useGameStore } from '../store';
import { isChunkTerrainDirty, getGlobalStamp } from '../utils/terrainOffsets';
import { getMudLevel, isMudChunkDirty, getMudGlobalStamp } from '../utils/mudEngine';
import { getRenderConfig } from '../utils/qualityTier';

// Hoisted Color objects
const _color = new THREE.Color();
const _mudColor = new THREE.Color('#4a3018');
const _snowColor = new THREE.Color('#ffffff');
const _rockColor = new THREE.Color('#888888');
const _forestColor = new THREE.Color('#4a5d23');
const _sandColor = new THREE.Color('#e6d59d');

/**
 * Fill a subsection of the merged position/color buffers for one chunk
 * using the requested ring template.
 */
function fillChunkVertices(
  pos: Float32Array,
  colors: Float32Array,
  vertexOffset: number,
  chunkX: number,
  chunkZ: number,
  templatePos: Float32Array
) {
  const worldOffsetX = chunkX * CHUNK_SIZE;
  const worldOffsetZ = chunkZ * CHUNK_SIZE;

  for (let i = 0; i < templatePos.length; i += 3) {
    const vi = vertexOffset + i;
    
    // World position (template is centered at 0,0,0)
    const wx = templatePos[i] + worldOffsetX;
    const wz = templatePos[i + 2] + worldOffsetZ;
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

function fillChunkIndices(
  indices: Uint32Array,
  indexOffset: number,
  vertexBase: number,
  templateIdx: Uint32Array | Uint16Array | ArrayLike<number>
) {
  for (let i = 0; i < templateIdx.length; i++) {
    indices[indexOffset + i] = vertexBase + templateIdx[i];
  }
}

interface RingProps {
  minRadius: number;
  maxRadius: number;
  segments: number;
}

function MergedTerrainRing({ minRadius, maxRadius, segments }: RingProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  const chunkMapRef = useRef<Map<string, number>>(new Map());
  const lastChunkCoordsRef = useRef('');
  const terrainStampsRef = useRef<Map<string, number>>(new Map());
  const mudStampsRef = useRef<Map<string, number>>(new Map());

  // Build the buffers for this specific ring topology
  const { templatePos, templateIdx, positions, colors, indices } = useMemo(() => {
    let chunkCount = 0;
    for (let dx = -maxRadius; dx <= maxRadius; dx++) {
      for (let dz = -maxRadius; dz <= maxRadius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) >= minRadius) chunkCount++;
      }
    }

    // Oversize the plane dynamically by 0.5m to mask T-Junction LOD cracks natively.
    const template = new THREE.PlaneGeometry(CHUNK_SIZE + 0.5, CHUNK_SIZE + 0.5, segments, segments);
    template.rotateX(-Math.PI / 2);
    
    const tPos = template.attributes.position.array as Float32Array;
    const tIdx = template.index!.array;

    const vertsPerChunk = (segments + 1) * (segments + 1);
    const trisPerChunk = segments * segments * 2;

    const pos = new Float32Array(chunkCount * vertsPerChunk * 3);
    const col = new Float32Array(chunkCount * vertsPerChunk * 3);
    const idx = new Uint32Array(chunkCount * trisPerChunk * 3);
    
    return { templatePos: tPos, templateIdx: tIdx, positions: pos, colors: col, indices: idx };
  }, [minRadius, maxRadius, segments]);

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

    if (coordsKey !== lastChunkCoordsRef.current) {
      lastChunkCoordsRef.current = coordsKey;
      needsFullRebuild = true;

      chunkMap.clear();
      terrainStampsRef.current.clear();
      mudStampsRef.current.clear();

      let slot = 0;
      for (let dx = -maxRadius; dx <= maxRadius; dx++) {
        for (let dz = -maxRadius; dz <= maxRadius; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) >= minRadius) {
            const key = `${cx + dx},${cz + dz}`;
            chunkMap.set(key, slot);
            terrainStampsRef.current.set(key, 0);
            mudStampsRef.current.set(key, 0);
            slot++;
          }
        }
      }
    }

    let anyDirty = false;
    const vertsPerChunk = (segments + 1) * (segments + 1);
    const trisPerChunk = segments * segments * 2;

    for (const [key, slot] of chunkMap) {
      const [kcx, kcz] = key.split(',').map(Number);
      const lastTerrain = terrainStampsRef.current.get(key) || 0;
      const lastMud = mudStampsRef.current.get(key) || 0;

      const terrainDirty = needsFullRebuild || isChunkTerrainDirty(kcx, kcz, lastTerrain);
      const mudDirty = !needsFullRebuild && isMudChunkDirty(kcx, kcz, lastMud);

      if (terrainDirty || mudDirty) {
        const vOffset = slot * vertsPerChunk * 3;
        fillChunkVertices(posAttr.array as Float32Array, colAttr.array as Float32Array, vOffset, kcx, kcz, templatePos);

        if (needsFullRebuild) {
          fillChunkIndices(geometry.index!.array as Uint32Array, slot * trisPerChunk * 3, slot * vertsPerChunk, templateIdx);
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

export function TerrainLODManager() {
  const viewDistance = getRenderConfig().chunkViewDistance;

  return (
    <group>
      {/* Ring 0: Inner Core (3x3 chunks). Maximum 40x40 detail mapping directly to physics layer */}
      <MergedTerrainRing minRadius={0} maxRadius={1} segments={40} />
      
      {/* Ring 1: Mid Distance. Half polynomial density (20x20). Used for typical extended horizon limits. */}
      {viewDistance >= 2 && (
        <MergedTerrainRing minRadius={2} maxRadius={2} segments={20} />
      )}

      {/* Ring 2: Extreme Horizon. Low density (10x10). Pushes bounds efficiently without bloating GPU budget. */}
      {viewDistance >= 3 && (
        <MergedTerrainRing minRadius={3} maxRadius={viewDistance} segments={10} />
      )}
    </group>
  );
}
