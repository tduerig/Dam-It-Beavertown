import { useMemo, useRef, useEffect, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CHUNK_SIZE, getTerrainHeight, getBaseTerrainHeight, generateTreesForChunk } from '../utils/terrain';
import { useGameStore } from '../store';
import { waterEngine } from '../utils/WaterEngine';
import { BRANCH_CONFIGS } from './DraggableLogs';
import { isChunkTerrainDirty, getGlobalStamp } from '../utils/terrainOffsets';
import { getMudLevel, isMudChunkDirty, getMudGlobalStamp } from '../utils/mudEngine';
import { woodEngine } from '../utils/woodEngine';

const dummy = new THREE.Object3D();
const HIDDEN_MATRIX = new THREE.Matrix4().makeTranslation(0, -1000, 0).scale(new THREE.Vector3(0, 0, 0));

// Types that Chunk renders as 3D tree geometry. Everything else (lily, cattail)
// is handled by GlobalFlora and must NOT get a trunk/leaves mesh.
const TREE_TYPES = new Set(['big', 'small', 'sapling']);

// Extra InstancedMesh capacity so ecology can add trees without remounting
const INSTANCE_HEADROOM = 48;

// Hoisted Color objects for terrain coloring (avoids allocation inside useMemo)
const _color = new THREE.Color();
const _mudColor = new THREE.Color('#4a3018');
const _snowColor = new THREE.Color('#ffffff');
const _rockColor = new THREE.Color('#888888');
const _forestColor = new THREE.Color('#4a5d23');
const _sandColor = new THREE.Color('#e6d59d');

function buildTerrainGeometry(chunkX: number, chunkZ: number): THREE.PlaneGeometry {
  const geo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, 40, 40);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position.array;
  const colors = new Float32Array(pos.length);
  
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i] + chunkX * CHUNK_SIZE;
    const z = pos[i + 2] + chunkZ * CHUNK_SIZE;
    const y = getTerrainHeight(x, z);
    const baseY = getBaseTerrainHeight(x, z);
    const offset = y - baseY;
    pos[i + 1] = y;

    // Biome colors based on altitude
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

    // Blend in mud color based on terrain modification OR water-generated mud
    const mudSat = getMudLevel(x, z);
    if (Math.abs(offset) > 0.05 || mudSat > 0.05) {
      const offsetBlend = Math.abs(offset) > 0.05 ? Math.min(1, Math.abs(offset) / 0.8) : 0;
      const blend = Math.max(offsetBlend, mudSat);
      _color.lerp(_mudColor, blend);
    }

    colors[i] = _color.r;
    colors[i + 1] = _color.g;
    colors[i + 2] = _color.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  return geo;
}

export function Chunk({ chunkX, chunkZ }: { chunkX: number, chunkZ: number }) {
  const chunkKey = `${chunkX},${chunkZ}`;
  
  // Localized terrain dirty tracking: only rebuild when THIS chunk is modified,
  // not when any remote chunk's terrain changes.
  const [terrainVersion, setTerrainVersion] = useState(0);
  const lastSeenStamp = useRef(0);
  const lastSeenMudStamp = useRef(0);
  
  // Poll for terrain dirtiness every 6 frames (~10Hz). This is MUCH cheaper
  // than subscribing to terrainOffsets and getting broadcast-invalidated on every
  // modification across all 49 chunks.
  useFrame(() => {
    if (isChunkTerrainDirty(chunkX, chunkZ, lastSeenStamp.current)) {
      lastSeenStamp.current = getGlobalStamp();
      setTerrainVersion(v => v + 1);
    } else if (isMudChunkDirty(chunkX, chunkZ, lastSeenMudStamp.current)) {
      lastSeenMudStamp.current = getMudGlobalStamp();
      setTerrainVersion(v => v + 1);
    }
  });

  const terrainGeo = useMemo(() => {
    return buildTerrainGeometry(chunkX, chunkZ);
  }, [chunkX, chunkZ, terrainVersion]);

  // trees is a LIVE reference to _treeCache[key] — ecology mutates it at runtime.
  // We grab the initial reference and track the rendered tree count dynamically.
  const treesRef = useRef(generateTreesForChunk(chunkX, chunkZ));
  const initialTreeCount = useMemo(() => treesRef.current.length, [chunkX, chunkZ]);
  const maxInstances = initialTreeCount + INSTANCE_HEADROOM;
  const lastRenderedCount = useRef(0);

  // Pre-allocated pool for big tree branch rendering
  const treePoolObj = useMemo(() => new THREE.Object3D(), []);
  const branchPoolObjs = useMemo(() => Array.from({length: 8}, () => new THREE.Object3D()), []);

  const { trunkGeo, leavesGeo, trunkMat, leavesMat, branchGeo, stumpGeo, stumpMat } = useMemo(() => {
    const tGeo = new THREE.CylinderGeometry(0.4, 0.6, 4, 8);
    tGeo.setAttribute('aWhittle', new THREE.InstancedBufferAttribute(new Float32Array(100), 1));
    
    const tMat = new THREE.MeshStandardMaterial({ color: '#5C4033' });
    tMat.onBeforeCompile = (shader) => {
      shader.vertexShader = `
        attribute float aWhittle;
        varying float vWhittle;
        varying float vY;
        ${shader.vertexShader}
      `.replace(
        `#include <begin_vertex>`,
        `
        #include <begin_vertex>
        vWhittle = aWhittle;
        vY = position.y;
        if (position.y < -1.0) {
          float d = clamp(abs(position.y + 1.5) / 0.5, 0.0, 1.0);
          float taperAmount = mix(mix(0.05, 1.0, d), 1.0, aWhittle);
          transformed.x *= taperAmount;
          transformed.z *= taperAmount;
        }
        `
      );
      shader.fragmentShader = `
        varying float vWhittle;
        varying float vY;
        ${shader.fragmentShader}
      `.replace(
        `vec4 diffuseColor = vec4( diffuse, opacity );`,
        `
        vec3 finalColor = diffuse;
        if (vY < -1.0 && vWhittle < 0.99) {
          float d = clamp(abs(vY + 1.5) / 0.5, 0.0, 1.0);
          float taperAmount = mix(mix(0.05, 1.0, d), 1.0, vWhittle);
          finalColor = mix(vec3(0.9, 0.75, 0.5), diffuse, taperAmount);
        }
        vec4 diffuseColor = vec4( finalColor, opacity );
        `
      );
    };

    const lGeo = new THREE.ConeGeometry(2.5, 5, 8);
    lGeo.setAttribute('aDissolve', new THREE.InstancedBufferAttribute(new Float32Array(100), 1));
    
    const lMat = new THREE.MeshStandardMaterial({ color: '#228B22', side: THREE.DoubleSide });
    lMat.onBeforeCompile = (shader) => {
      shader.vertexShader = `
        attribute float aDissolve;
        varying float vDissolve;
        varying vec3 vPos;
        ${shader.vertexShader}
      `.replace(
        `#include <begin_vertex>`,
        `
        #include <begin_vertex>
        vDissolve = aDissolve;
        vPos = position;
        `
      );
      shader.fragmentShader = `
        varying float vDissolve;
        varying vec3 vPos;
        
        float hash(vec3 p) {
          p = fract(p * 0.3183099 + .1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float noise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                         mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                         mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        ${shader.fragmentShader}
      `.replace(
        `vec4 diffuseColor = vec4( diffuse, opacity );`,
        `
        vec4 diffuseColor = vec4( diffuse, opacity );
        if (vDissolve < 0.99) {
          float n = noise(vPos * 2.0);
          float threshold = vDissolve * 1.2 - 0.1;
          if (n > threshold) {
            discard;
          }
          if (n > threshold - 0.15) {
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.4, 0.2, 0.0), 0.8);
          }
        }
        `
      );
    };

    const bGeo = new THREE.CylinderGeometry(0.1, 0.2, 1.5, 8);
    
    const sGeo = new THREE.ConeGeometry(0.6, 0.5, 8);
    const sMat = new THREE.MeshStandardMaterial({ color: '#E6C280' });
    
    // Explicit bounding sphere for native frustum culling
    const cullingSphere = new THREE.Sphere(new THREE.Vector3(0, 5, 0), 60);
    tGeo.boundingSphere = cullingSphere;
    lGeo.boundingSphere = cullingSphere;
    bGeo.boundingSphere = cullingSphere;
    sGeo.boundingSphere = cullingSphere;

    return { trunkGeo: tGeo, trunkMat: tMat, leavesGeo: lGeo, leavesMat: lMat, branchGeo: bGeo, stumpGeo: sGeo, stumpMat: sMat };
  }, []);

  const trunkMeshRef = useRef<THREE.InstancedMesh>(null);
  const leavesMeshRef = useRef<THREE.InstancedMesh>(null);
  const branchesMeshRef = useRef<THREE.InstancedMesh>(null);
  const stumpMeshRef = useRef<THREE.InstancedMesh>(null);
  const leavesScales = useRef(new Map<string, number>());
  const waterCheckCounter = useRef(0);
  const lastSeenFloraStamp = useRef(-1);
  const renderableTreesRef = useRef<{ tree: any, origIdx: number }[]>([]);
  const lastTreesLength = useRef(-1);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.1);
    if (!trunkMeshRef.current || !leavesMeshRef.current) return;
    
    // Live reference — ecology may have pushed new items since last frame
    const trees = treesRef.current;
    
    // Filter to only renderable tree types (skip lily, cattail — GlobalFlora handles those)
    // Cached to avoid massive GC storm (AP-1)
    if (trees.length !== lastTreesLength.current) {
      lastTreesLength.current = trees.length;
      const newRenderable = [];
      for (let i = 0; i < trees.length; i++) {
        if (TREE_TYPES.has(trees[i].type)) {
          newRenderable.push({ tree: trees[i], origIdx: i });
        }
      }
      renderableTreesRef.current = newRenderable;
    }
    const renderableTrees = renderableTreesRef.current;
    
    // ── Dirty-flag check ──────────────────────────────────────────────
    // Only recompute if woodEngine flagged this chunk or animating
    let isDirty = woodEngine.isChunkFloraDirty(chunkKey, lastSeenFloraStamp.current);
    
    // Also dirty if renderable count changed (ecology added/removed trees)
    if (renderableTrees.length !== lastRenderedCount.current) isDirty = true;
    
    // Check if any leaf dissolution is in progress
    for (const [, scale] of leavesScales.current) {
      if (scale > 0 && scale < 1) { isDirty = true; break; }
    }

    
    // Periodic water level check (every 10 frames) to detect flooding
    waterCheckCounter.current++;
    if (waterCheckCounter.current >= 10) {
      waterCheckCounter.current = 0;
      for (const { tree } of renderableTrees) {
        const waterH = waterEngine.getSurfaceHeight(tree.position[0], tree.position[2]);
        const scale = tree.type === 'big' ? 2.8 : (tree.type === 'sapling' ? 0.4 : 1);
        const isFlooded = waterH > tree.position[1] + (1 * scale);
        const currentScale = leavesScales.current.get(tree.id) ?? 1;
        const targetScale = isFlooded ? 0 : 1;
        if (Math.abs(currentScale - targetScale) > 0.01) {
          isDirty = true;
          break;
        }
      }
    }
    
    if (!isDirty) return; // ← THIS IS THE BIG WIN: skip 95% of frames
    lastSeenFloraStamp.current = woodEngine.getChunkStamp(chunkKey);
    lastRenderedCount.current = renderableTrees.length;
    let keepAnimating = false;
    
    const time = Date.now() * 0.001;

    // Clamp to buffer capacity
    const renderCount = Math.min(renderableTrees.length, maxInstances);
    
    // Set mesh.count to exactly the number of active renderable trees.
    // This prevents ghost instances from stale matrices at higher indices.
    trunkMeshRef.current.count = renderCount;
    leavesMeshRef.current.count = renderCount;
    if (stumpMeshRef.current) stumpMeshRef.current.count = renderCount;
    if (branchesMeshRef.current) branchesMeshRef.current.count = renderCount * BRANCH_CONFIGS.length;

    for (let ri = 0; ri < renderCount; ri++) {
      const tree = renderableTrees[ri].tree;
      const i = ri; // instance index (contiguous, no gaps)
      const isBig = tree.type === 'big';
      const isSapling = tree.type === 'sapling';
      const scale = isBig ? 2.8 : (isSapling ? 0.4 : 1);
      
      const maxSticks = isBig ? 12 : 3;
      const currentSticks = woodEngine.getSticks(tree.id, isBig);
      const isFelled = currentSticks <= 0;
      const whittleScale = currentSticks / maxSticks;
      
      if (i < 100 && !isFelled) {
        trunkGeo.attributes.aWhittle.setX(i, whittleScale);
      }
      
      if (isFelled) {
        // Hide tree completely
        dummy.position.set(0, -1000, 0);
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        trunkMeshRef.current!.setMatrixAt(i, dummy.matrix);
        leavesMeshRef.current!.setMatrixAt(i, dummy.matrix);
        
        if (branchesMeshRef.current) {
          BRANCH_CONFIGS.forEach((_, bIdx) => {
            branchesMeshRef.current!.setMatrixAt(i * BRANCH_CONFIGS.length + bIdx, dummy.matrix);
          });
        }
        
        // Show stump
        if (stumpMeshRef.current) {
          dummy.position.set(
            tree.position[0] - chunkX * CHUNK_SIZE, 
            tree.position[1] + (0.25 * scale), // stump offset
            tree.position[2] - chunkZ * CHUNK_SIZE
          );
          dummy.scale.set(scale, scale, scale);
          dummy.rotation.set(0, 0, 0);
          dummy.updateMatrix();
          stumpMeshRef.current!.setMatrixAt(i, dummy.matrix);
        }
        continue;
      }
      
      // Stump hide (tree is alive)
      if (stumpMeshRef.current) {
        dummy.position.set(0, -1000, 0);
        dummy.scale.set(0, 0, 0);
        dummy.updateMatrix();
        stumpMeshRef.current!.setMatrixAt(i, dummy.matrix);
      }
      
      // Base position for alive trunk
      dummy.position.set(
        tree.position[0] - chunkX * CHUNK_SIZE, 
        tree.position[1] + (2 * scale), // trunk offset
        tree.position[2] - chunkZ * CHUNK_SIZE
      );
      
      dummy.scale.set(scale, scale, scale);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      trunkMeshRef.current!.setMatrixAt(i, dummy.matrix);
      
      // Check if flooded
      const waterHeight = waterEngine.getSurfaceHeight(tree.position[0], tree.position[2]);
      const isFlooded = waterHeight > tree.position[1] + (1 * scale); // Flooded if water is above base of trunk
      
      // Leaves
      dummy.position.y += (3.75 * scale); // leaves offset
      
      // Scale leaves based on flooding only
      const targetLeavesScale = isFlooded ? 0 : 1;
      let currentLeavesScale = leavesScales.current.get(tree.id) ?? targetLeavesScale;
      
      // Gradually change leaves scale
      if (currentLeavesScale < targetLeavesScale) {
        currentLeavesScale = Math.min(targetLeavesScale, currentLeavesScale + dt * 0.5);
      } else if (currentLeavesScale > targetLeavesScale) {
        currentLeavesScale = Math.max(targetLeavesScale, currentLeavesScale - dt * 0.5);
      }
      leavesScales.current.set(tree.id, currentLeavesScale);
      if (currentLeavesScale > 0 && currentLeavesScale < 1) keepAnimating = true; // Keep ticking
      
      if (i < 100) {
        leavesGeo.attributes.aDissolve.setX(i, currentLeavesScale);
      }
      
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      leavesMeshRef.current!.setMatrixAt(i, dummy.matrix);
      
      // Branches (only for big trees)
      if (branchesMeshRef.current) {
        if (isBig) {
          treePoolObj.position.set(
            tree.position[0] - chunkX * CHUNK_SIZE,
            tree.position[1] + (2 * scale),
            tree.position[2] - chunkZ * CHUNK_SIZE
          );
          treePoolObj.scale.set(scale, scale, scale);
          treePoolObj.rotation.set(0, 0, 0);
          treePoolObj.updateMatrix();
          treePoolObj.updateMatrixWorld(true);
          
          BRANCH_CONFIGS.forEach((config, bIdx) => {
            const b = branchPoolObjs[bIdx];
            b.position.set(config.pos[0] / 2.8, config.pos[1] / 2.8, config.pos[2] / 2.8);
            b.quaternion.set(config.quat[0], config.quat[1], config.quat[2], config.quat[3]);
            const branchScale = config.scale[0] * (0.1 + 0.9 * (1 - currentLeavesScale));
            b.scale.set(branchScale, branchScale, branchScale);
            b.updateMatrix();
            b.matrixWorld.multiplyMatrices(treePoolObj.matrixWorld, b.matrix);
            branchesMeshRef.current!.setMatrixAt(i * BRANCH_CONFIGS.length + bIdx, b.matrixWorld);
          });
        } else {
          // Hide branch for small trees
          BRANCH_CONFIGS.forEach((_, bIdx) => {
            dummy.position.set(0, -1000, 0);
            dummy.scale.set(0, 0, 0);
            dummy.updateMatrix();
            branchesMeshRef.current!.setMatrixAt(i * BRANCH_CONFIGS.length + bIdx, dummy.matrix);
          });
        }
      }
    }
    
    trunkMeshRef.current.instanceMatrix.needsUpdate = true;
    leavesMeshRef.current.instanceMatrix.needsUpdate = true;
    if (branchesMeshRef.current) {
      branchesMeshRef.current.instanceMatrix.needsUpdate = true;
    }
    if (stumpMeshRef.current) {
      stumpMeshRef.current.instanceMatrix.needsUpdate = true;
    }
    if (renderCount > 0) {
      trunkGeo.attributes.aWhittle.needsUpdate = true;
      leavesGeo.attributes.aDissolve.needsUpdate = true;
    }
    
    // Request follow-up frame if animations persist
    if (!keepAnimating && isDirty) {
      // Clean flag inside native module already checked
    } else if (keepAnimating) {
      // Force next frame to render
      lastSeenFloraStamp.current = -1;
    }
  });

  return (
    <group position={[chunkX * CHUNK_SIZE, 0, chunkZ * CHUNK_SIZE]}>
      <mesh geometry={terrainGeo} receiveShadow>
        <meshStandardMaterial vertexColors={true} roughness={0.8} metalness={0.1} />
      </mesh>

      {maxInstances > 0 && (
        <>
          <instancedMesh ref={trunkMeshRef} args={[trunkGeo, trunkMat, maxInstances]} castShadow receiveShadow frustumCulled={true} />
          <instancedMesh ref={leavesMeshRef} args={[leavesGeo, leavesMat, maxInstances]} castShadow receiveShadow frustumCulled={true} />
          <instancedMesh ref={branchesMeshRef} args={[branchGeo, trunkMat, maxInstances * BRANCH_CONFIGS.length]} castShadow receiveShadow frustumCulled={true} />
          <instancedMesh ref={stumpMeshRef} args={[stumpGeo, stumpMat, maxInstances]} castShadow receiveShadow frustumCulled={true} />
        </>
      )}
    </group>
  );
}
