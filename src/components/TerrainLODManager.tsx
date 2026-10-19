import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CHUNK_SIZE, getTerrainHeight } from '../utils/terrain';
import { useGameStore } from '../store';
import { isChunkTerrainDirty, getGlobalStamp, hasAnyOffsets, getInterpolatedOffset } from '../utils/terrainOffsets';
import { getMudLevel, isMudChunkDirty, getMudGlobalStamp } from '../utils/mudEngine';
import { getRenderConfig, createMaterial } from '../utils/qualityTier';

// Hoisted objects
const _color = new THREE.Color();
const _mudColor = new THREE.Color('#4a3018');
const _snowColor = new THREE.Color('#ffffff');
const _rockColor = new THREE.Color('#888888');
const _forestColor = new THREE.Color('#4a5d23');
const _sandColor = new THREE.Color('#e6d59d');
const _freeSlotIndices: number[] = [];
const _keptChunkKeys = new Set<number>();

export function getAnalyticalNormal(x: number, z: number, target: THREE.Vector3): THREE.Vector3 {
  const hL = getTerrainHeight(x - 1, z);
  const hR = getTerrainHeight(x + 1, z);
  const hD = getTerrainHeight(x, z - 1);
  const hU = getTerrainHeight(x, z + 1);
  const nx = hL - hR;
  const nz = hD - hU;
  const invLen = 1.0 / Math.sqrt(nx * nx + 4.0 + nz * nz);
  target.set(nx * invLen, 2.0 * invLen, nz * invLen);
  return target;
}

function fillChunkVertices(
  pos: Float32Array,
  colors: Float32Array,
  normals: Float32Array,
  vertexOffset: number,
  chunkX: number,
  chunkZ: number,
  segments: number,
  templatePos: Float32Array
) {
  const worldOffsetX = chunkX * CHUNK_SIZE;
  const worldOffsetZ = chunkZ * CHUNK_SIZE;
  const hasOffsets = hasAnyOffsets();

  for (let i = 0; i < templatePos.length; i += 3) {
    const vi = vertexOffset + i;
    
    const wx = templatePos[i] + worldOffsetX;
    const wz = templatePos[i + 2] + worldOffsetZ;
    const y = getTerrainHeight(wx, wz);
    const offset = hasOffsets ? getInterpolatedOffset(wx, wz) : 0;

    pos[vi]     = wx;
    pos[vi + 1] = y;
    pos[vi + 2] = wz;

    if (y > 14) _color.copy(_snowColor);
    else if (y > 10) _color.copy(_rockColor).lerp(_snowColor, (y - 10) / 4);
    else if (y > 0) _color.copy(_forestColor).lerp(_rockColor, y / 10);
    else if (y > -4) _color.copy(_sandColor).lerp(_forestColor, (y + 4) / 4);
    else _color.copy(_sandColor);

    const mudSat = getMudLevel(wx, wz, y - offset);
    if (Math.abs(offset) > 0.05 || mudSat > 0.05) {
      const offsetBlend = Math.abs(offset) > 0.05 ? Math.min(1, Math.abs(offset) / 0.8) : 0;
      const blend = Math.max(offsetBlend, mudSat);
      _color.lerp(_mudColor, blend);
    }

    colors[vi]     = _color.r;
    colors[vi + 1] = _color.g;
    colors[vi + 2] = _color.b;
  }

  // Compute smooth analytical normals directly from the chunk's populated height grid (0 extra getTerrainHeight calls)
  const cols = segments + 1;
  const stride = cols * 3;
  const step = (CHUNK_SIZE + 0.5) / segments;
  for (let iz = 0; iz <= segments; iz++) {
    const rowBase = vertexOffset + iz * stride;
    const dzSpan = iz > 0 && iz < segments ? 2.0 * step : step;
    const invDz = 1.0 / dzSpan;
    for (let ix = 0; ix <= segments; ix++) {
      const vi = rowBase + ix * 3;
      const dxSpan = ix > 0 && ix < segments ? 2.0 * step : step;
      const hL = ix > 0 ? pos[vi - 3 + 1] : pos[vi + 1];
      const hR = ix < segments ? pos[vi + 3 + 1] : pos[vi + 1];
      const hD = iz > 0 ? pos[vi - stride + 1] : pos[vi + 1];
      const hU = iz < segments ? pos[vi + stride + 1] : pos[vi + 1];
      const nx = (hL - hR) / dxSpan;
      const nz = (hD - hU) * invDz;
      const invLen = 1.0 / Math.sqrt(nx * nx + 1.0 + nz * nz);
      normals[vi]     = nx * invLen;
      normals[vi + 1] = invLen;
      normals[vi + 2] = nz * invLen;
    }
  }
}

interface RingProps {
  minRadius: number;
  maxRadius: number;
  segments: number;
}

interface ChunkSlot {
  cx: number;
  cz: number;
  slot: number;
  terrainStamp: number;
  mudStamp: number;
}

function MergedTerrainRing({ minRadius, maxRadius, segments }: RingProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const chunkSlotsRef = useRef<ChunkSlot[]>([]);
  const lastChunkXRef = useRef(NaN);
  const lastChunkZRef = useRef(NaN);
  const lastGlobalTerrainRef = useRef(-1);
  const lastGlobalMudRef = useRef(-1);

  const terrainMaterial = useMemo(
    () => createMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.1 }),
    []
  );

  const { templatePos, positions, colors, normals, indices } = useMemo(() => {
    let chunkCount = 0;
    for (let dx = -maxRadius; dx <= maxRadius; dx++) {
      for (let dz = -maxRadius; dz <= maxRadius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) >= minRadius) chunkCount++;
      }
    }

    const template = new THREE.PlaneGeometry(CHUNK_SIZE + 0.5, CHUNK_SIZE + 0.5, segments, segments);
    template.rotateX(-Math.PI / 2);
    
    const tPos = template.attributes.position.array as Float32Array;
    const tIdx = template.index!.array;

    const vertsPerChunk = (segments + 1) * (segments + 1);
    const trisPerChunk = segments * segments * 2;

    const pos = new Float32Array(chunkCount * vertsPerChunk * 3);
    const col = new Float32Array(chunkCount * vertsPerChunk * 3);
    const norm = new Float32Array(chunkCount * vertsPerChunk * 3);
    const idx = new Uint32Array(chunkCount * trisPerChunk * 3);

    // Pre-populate static slot indices once (indices only depend on slot index, never on cx/cz)
    for (let s = 0; s < chunkCount; s++) {
      const indexOffset = s * trisPerChunk * 3;
      const vertexBase = s * vertsPerChunk;
      for (let i = 0; i < tIdx.length; i++) {
        idx[indexOffset + i] = vertexBase + tIdx[i];
      }
    }
    
    return { templatePos: tPos, positions: pos, colors: col, normals: norm, indices: idx };
  }, [minRadius, maxRadius, segments]);

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    return geo;
  }, [positions, colors, normals, indices]);

  useFrame(() => {
    const state = useGameStore.getState();
    if (state.gameState !== 'playing' && state.gameState !== 'paused') return;

    const cx = Math.floor((state.playerPosition[0] + CHUNK_SIZE / 2) / CHUNK_SIZE);
    const cz = Math.floor((state.playerPosition[2] + CHUNK_SIZE / 2) / CHUNK_SIZE);
    const globalTerrainStamp = getGlobalStamp();
    const globalMudStamp = getMudGlobalStamp();

    const slots = chunkSlotsRef.current;

    if (cx !== lastChunkXRef.current || cz !== lastChunkZRef.current) {
      lastChunkXRef.current = cx;
      lastChunkZRef.current = cz;

      if (slots.length === 0) {
        let slotIdx = 0;
        for (let dx = -maxRadius; dx <= maxRadius; dx++) {
          for (let dz = -maxRadius; dz <= maxRadius; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) >= minRadius) {
              slots.push({
                cx: cx + dx,
                cz: cz + dz,
                slot: slotIdx++,
                terrainStamp: -1,
                mudStamp: -1,
              });
            }
          }
        }
      } else {
        // Incremental slot reuse: keep chunks that are still within [minRadius, maxRadius] of (cx, cz),
        // and only reassign vacated slots to newly-entering chunks!
        _freeSlotIndices.length = 0;
        _keptChunkKeys.clear();
        for (let i = 0; i < slots.length; i++) {
          const entry = slots[i];
          const rMax = Math.max(Math.abs(entry.cx - cx), Math.abs(entry.cz - cz));
          if (rMax >= minRadius && rMax <= maxRadius) {
            _keptChunkKeys.add(((entry.cx + 32768) << 16) | ((entry.cz + 32768) & 0xffff));
          } else {
            _freeSlotIndices.push(i);
          }
        }

        let freePtr = 0;
        for (let dx = -maxRadius; dx <= maxRadius; dx++) {
          for (let dz = -maxRadius; dz <= maxRadius; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) >= minRadius) {
              const kcx = cx + dx;
              const kcz = cz + dz;
              const key = ((kcx + 32768) << 16) | ((kcz + 32768) & 0xffff);
              if (!_keptChunkKeys.has(key) && freePtr < _freeSlotIndices.length) {
                const entry = slots[_freeSlotIndices[freePtr++]];
                entry.cx = kcx;
                entry.cz = kcz;
                entry.terrainStamp = -1;
                entry.mudStamp = -1;
              }
            }
          }
        }
      }
    } else if (
      globalTerrainStamp === lastGlobalTerrainRef.current &&
      globalMudStamp === lastGlobalMudRef.current
    ) {
      // Fast-path: player hasn't crossed a chunk boundary and no terrain or mud changed anywhere
      return;
    }

    lastGlobalTerrainRef.current = globalTerrainStamp;
    lastGlobalMudRef.current = globalMudStamp;

    const posAttr = geometry.attributes.position as THREE.BufferAttribute;
    const colAttr = geometry.attributes.color as THREE.BufferAttribute;
    const normAttr = geometry.attributes.normal as THREE.BufferAttribute;

    let anyDirty = false;
    const vertsPerChunk = (segments + 1) * (segments + 1);

    for (let i = 0; i < slots.length; i++) {
      const entry = slots[i];
      const kcx = entry.cx;
      const kcz = entry.cz;

      const isNewSlot = entry.terrainStamp < 0;
      const terrainDirty = isNewSlot || isChunkTerrainDirty(kcx, kcz, entry.terrainStamp);
      const mudDirty = !isNewSlot && isMudChunkDirty(kcx, kcz, entry.mudStamp);

      if (terrainDirty || mudDirty) {
        const vOffset = entry.slot * vertsPerChunk * 3;
        fillChunkVertices(
          posAttr.array as Float32Array,
          colAttr.array as Float32Array,
          normAttr.array as Float32Array,
          vOffset,
          kcx,
          kcz,
          segments,
          templatePos
        );

        entry.terrainStamp = globalTerrainStamp;
        entry.mudStamp = globalMudStamp;
        anyDirty = true;
      }
    }

    if (anyDirty) {
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
      normAttr.needsUpdate = true;
      geometry.computeBoundingSphere();
    }
  });

  return (
    <mesh ref={meshRef} geometry={geometry} material={terrainMaterial} receiveShadow />
  );
}

export function TerrainLODManager() {
  const viewDistance = getRenderConfig().chunkViewDistance;

  return (
    <group>
      <MergedTerrainRing minRadius={0} maxRadius={1} segments={40} />
      {viewDistance >= 2 && (
        <MergedTerrainRing minRadius={2} maxRadius={2} segments={20} />
      )}
      {viewDistance >= 3 && (
        <MergedTerrainRing minRadius={3} maxRadius={viewDistance} segments={10} />
      )}
    </group>
  );
}
