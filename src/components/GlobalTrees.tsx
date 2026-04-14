/**
 * GlobalTrees — Phase 2 GPU optimization.
 *
 * Consolidates ALL tree rendering into 4 global InstancedMeshes
 * (trunks, leaves, branches, stumps) instead of 4 per chunk (= ~100 draw calls).
 *
 * Uses the same dirty-flagging pattern as MergedTerrain: iterate over
 * active chunks, check woodEngine.isChunkFloraDirty and floraCache, and
 * only upload instance matrices when something actually changed.
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CHUNK_SIZE, generateTreesForChunk } from '../utils/terrain';
import { useGameStore } from '../store';
import { waterEngine } from '../utils/WaterEngine';
import { BRANCH_CONFIGS } from './DraggableLogs';
import { woodEngine } from '../utils/woodEngine';
import { getRenderConfig } from '../utils/qualityTier';

// Types that render as 3D tree geometry (same filter as old Chunk.tsx)
const TREE_TYPES = new Set(['big', 'small', 'sapling']);

// Maximum trees across all visible chunks.
// viewDistance=2 → 25 chunks × ~32 trees/chunk = ~800 max, but many are
// filtered out by biome/river, so 500 is a safe upper bound with headroom.
const MAX_TREES = 500;
const NUM_BRANCHES = BRANCH_CONFIGS.length; // 8

// Reusable Object3D pool
const _dummy = new THREE.Object3D();
const _treePoolObj = new THREE.Object3D();
const _branchPoolObjs = Array.from({ length: 8 }, () => new THREE.Object3D());

// Frustum culling – replaces the per-chunk frustumCulled={true} that the old
// Chunk InstancedMeshes got for free from Three.js.
const _frustum = new THREE.Frustum();
const _projScreenMatrix = new THREE.Matrix4();
const _chunkSphere = new THREE.Sphere(new THREE.Vector3(), CHUNK_SIZE * 0.75); // generous radius
const _hiddenMatrix = new THREE.Matrix4().makeTranslation(0, -1000, 0).scale(new THREE.Vector3(0, 0, 0));

export function GlobalTrees() {
  const trunkRef = useRef<THREE.InstancedMesh>(null);
  const leavesRef = useRef<THREE.InstancedMesh>(null);
  const branchRef = useRef<THREE.InstancedMesh>(null);
  const stumpRef = useRef<THREE.InstancedMesh>(null);

  // Dirty-tracking state
  const lastChunkCoordsRef = useRef('');
  const floraStampsRef = useRef(new Map<string, number>());
  const leavesScalesRef = useRef(new Map<string, number>());
  const waterCheckCounter = useRef(0);
  const lastTreeCount = useRef(-1);

  // Build shared geometry + materials exactly matching the old Chunk.tsx
  const { trunkGeo, leavesGeo, trunkMat, leavesMat, branchGeo, stumpGeo, stumpMat } = useMemo(() => {
    // ── Trunk ──
    const tGeo = new THREE.CylinderGeometry(0.4, 0.6, 4, 8);
    tGeo.setAttribute('aWhittle', new THREE.InstancedBufferAttribute(new Float32Array(MAX_TREES), 1));
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

    // ── Precompute Noise Texture ──
    // Replaces the 70-FLOP procedural noise shader on mobile for massive fill-rate savings
    const texSize = 64;
    const texData = new Uint8Array(texSize * texSize * 4);
    for (let i = 0; i < texSize * texSize * 4; i += 4) {
      const v = Math.random() * 255;
      texData[i] = v; texData[i + 1] = v; texData[i + 2] = v; texData[i + 3] = 255;
    }
    const noiseTex = new THREE.DataTexture(texData, texSize, texSize, THREE.RGBAFormat);
    noiseTex.wrapS = THREE.RepeatWrapping;
    noiseTex.wrapT = THREE.RepeatWrapping;
    noiseTex.magFilter = THREE.LinearFilter;
    noiseTex.minFilter = THREE.LinearFilter;
    noiseTex.needsUpdate = true;

    // ── Leaves ──
    const lGeo = new THREE.ConeGeometry(2.5, 5, 8);
    lGeo.setAttribute('aDissolve', new THREE.InstancedBufferAttribute(new Float32Array(MAX_TREES), 1));
    // Restored DoubleSide to eliminate shadow/normal artifacts on mobile
    const lMat = new THREE.MeshStandardMaterial({ color: '#228B22', side: THREE.DoubleSide });
    lMat.onBeforeCompile = (shader) => {
      shader.uniforms.tNoise = { value: noiseTex };
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
        uniform sampler2D tNoise;
        varying float vDissolve;
        varying vec3 vPos;
        ${shader.fragmentShader}
      `.replace(
        `vec4 diffuseColor = vec4( diffuse, opacity );`,
        `
        vec4 diffuseColor = vec4( diffuse, opacity );
        
        // Hoisted OUTSIDE dynamic flow control to prevent Adreno driver corruption
        float rawNoise = texture2D(tNoise, vPos.xy * 0.5).r;
        
        if (vDissolve < 0.99) {
          float threshold = vDissolve * 1.2 - 0.1;
          if (rawNoise > threshold) {
            discard;
          }
          if (rawNoise > threshold - 0.15) {
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.4, 0.2, 0.0), 0.8);
          }
        }
        `
      );
    };

    // ── Branches ──
    const bGeo = new THREE.CylinderGeometry(0.1, 0.2, 1.5, 8);
    // CRITICAL: MUST provide aWhittle attribute because it shares trunkMat. Missing this causes global WebGL corruption on Android!
    bGeo.setAttribute('aWhittle', new THREE.InstancedBufferAttribute(new Float32Array(MAX_TREES * NUM_BRANCHES), 1));

    // ── Stumps ──
    const sGeo = new THREE.ConeGeometry(0.6, 0.5, 8);
    const sMat = new THREE.MeshStandardMaterial({ color: '#E6C280' });

    // Large bounding sphere so frustum culling doesn't hide distant instances
    const cullingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 500);
    tGeo.boundingSphere = cullingSphere;
    lGeo.boundingSphere = cullingSphere;
    bGeo.boundingSphere = cullingSphere;
    sGeo.boundingSphere = cullingSphere;

    return {
      trunkGeo: tGeo, trunkMat: tMat,
      leavesGeo: lGeo, leavesMat: lMat,
      branchGeo: bGeo,
      stumpGeo: sGeo, stumpMat: sMat,
    };
  }, []);

  useFrame((state, delta) => {
    const gs = useGameStore.getState();
    if (gs.gameState !== 'playing' && gs.gameState !== 'paused') return;
    if (!trunkRef.current || !leavesRef.current) return;

    const dt = Math.min(delta, 0.1);
    const viewDistance = getRenderConfig().chunkViewDistance;
    const cx = Math.floor(gs.playerPosition[0] / CHUNK_SIZE);
    const cz = Math.floor(gs.playerPosition[2] / CHUNK_SIZE);
    const coordsKey = `${cx},${cz}`;

    // ── Build camera frustum for per-chunk culling ──
    // This replaces the automatic frustumCulled={true} that each old
    // per-chunk InstancedMesh got for free. Without it, we vertex-shade
    // every tree in the world including those behind the camera.
    _projScreenMatrix.multiplyMatrices(
      state.camera.projectionMatrix,
      state.camera.matrixWorldInverse
    );
    _frustum.setFromProjectionMatrix(_projScreenMatrix);

    // ── Detect chunk boundary crossing → full rebuild ──
    let needsFullRebuild = false;
    if (coordsKey !== lastChunkCoordsRef.current) {
      lastChunkCoordsRef.current = coordsKey;
      needsFullRebuild = true;
      floraStampsRef.current.clear();
    }

    // ── Detect per-chunk dirtiness ──
    let anyDirty = needsFullRebuild;
    if (!anyDirty) {
      for (let dx = -viewDistance; dx <= viewDistance; dx++) {
        for (let dz = -viewDistance; dz <= viewDistance; dz++) {
          const key = `${cx + dx},${cz + dz}`;
          const lastStamp = floraStampsRef.current.get(key) || 0;
          if (woodEngine.isChunkFloraDirty(key, lastStamp)) {
            anyDirty = true;
            break;
          }
        }
        if (anyDirty) break;
      }
    }

    // ── Periodic water-level flooding check (every 10 frames) ──
    waterCheckCounter.current++;
    const doWaterCheck = waterCheckCounter.current >= 10;
    if (doWaterCheck) waterCheckCounter.current = 0;

    // Check if any leaves are mid-animation
    let keepAnimating = false;
    for (const [, scale] of leavesScalesRef.current) {
      if (scale > 0 && scale < 1) { anyDirty = true; keepAnimating = true; break; }
    }

    if (!anyDirty && !doWaterCheck) return;

    // ── Gather all trees across VISIBLE chunks ──
    let slot = 0;
    for (let dx = -viewDistance; dx <= viewDistance; dx++) {
      for (let dz = -viewDistance; dz <= viewDistance; dz++) {
        const kcx = cx + dx;
        const kcz = cz + dz;
        const key = `${kcx},${kcz}`;
        const trees = generateTreesForChunk(kcx, kcz);

        // ── Per-chunk frustum cull ──
        // Test the chunk's bounding sphere against the camera frustum.
        // If the entire chunk is off-screen, skip all its trees.
        _chunkSphere.center.set(kcx * CHUNK_SIZE, 5, kcz * CHUNK_SIZE);
        if (!_frustum.intersectsSphere(_chunkSphere)) {
          // Still update the flora stamp so we don't re-trigger dirty next frame
          floraStampsRef.current.set(key, woodEngine.getChunkStamp(key));
          continue;
        }

        // Update flora stamp for this chunk
        floraStampsRef.current.set(key, woodEngine.getChunkStamp(key));

        for (let ti = 0; ti < trees.length; ti++) {
          const tree = trees[ti];
          if (!TREE_TYPES.has(tree.type)) continue;
          if (slot >= MAX_TREES) break;

          const isBig = tree.type === 'big';
          const isSapling = tree.type === 'sapling';
          const scale = isBig ? 2.8 : (isSapling ? 0.4 : 1);
          const maxSticks = isBig ? 12 : 3;
          const currentSticks = woodEngine.getSticks(tree.id, isBig);
          const isFelled = currentSticks <= 0;
          const whittleScale = currentSticks / maxSticks;

          // ── aWhittle attribute ──
          if (slot < MAX_TREES && !isFelled) {
            trunkGeo.attributes.aWhittle.setX(slot, whittleScale);
          }

          if (isFelled) {
            // Hide trunk + leaves + branches
            trunkRef.current!.setMatrixAt(slot, _hiddenMatrix);
            leavesRef.current!.setMatrixAt(slot, _hiddenMatrix);
            if (branchRef.current) {
              for (let bIdx = 0; bIdx < NUM_BRANCHES; bIdx++) {
                branchRef.current!.setMatrixAt(slot * NUM_BRANCHES + bIdx, _hiddenMatrix);
              }
            }
            // Show stump (world-space position)
            if (stumpRef.current) {
              _dummy.position.set(tree.position[0], tree.position[1] + (0.25 * scale), tree.position[2]);
              _dummy.scale.set(scale, scale, scale);
              _dummy.rotation.set(0, 0, 0);
              _dummy.updateMatrix();
              stumpRef.current!.setMatrixAt(slot, _dummy.matrix);
            }
            slot++;
            continue;
          }

          // ── Stump hide (tree is alive) ──
          if (stumpRef.current) {
            stumpRef.current!.setMatrixAt(slot, _hiddenMatrix);
          }

          // ── Trunk (world-space position) ──
          _dummy.position.set(tree.position[0], tree.position[1] + (2 * scale), tree.position[2]);
          _dummy.scale.set(scale, scale, scale);
          _dummy.rotation.set(0, 0, 0);
          _dummy.updateMatrix();
          trunkRef.current!.setMatrixAt(slot, _dummy.matrix);

          // ── Flooding check ──
          const waterHeight = waterEngine.getSurfaceHeight(tree.position[0], tree.position[2]);
          const isFlooded = waterHeight > tree.position[1] + (1 * scale);

          // ── Leaves ──
          _dummy.position.y += (3.75 * scale);
          const targetLeavesScale = isFlooded ? 0 : 1;
          let currentLeavesScale = leavesScalesRef.current.get(tree.id) ?? targetLeavesScale;
          if (currentLeavesScale < targetLeavesScale) {
            currentLeavesScale = Math.min(targetLeavesScale, currentLeavesScale + dt * 0.5);
          } else if (currentLeavesScale > targetLeavesScale) {
            currentLeavesScale = Math.max(targetLeavesScale, currentLeavesScale - dt * 0.5);
          }
          leavesScalesRef.current.set(tree.id, currentLeavesScale);
          if (currentLeavesScale > 0 && currentLeavesScale < 1) keepAnimating = true;

          if (slot < MAX_TREES) {
            leavesGeo.attributes.aDissolve.setX(slot, currentLeavesScale);
          }
          _dummy.scale.set(scale, scale, scale);
          _dummy.updateMatrix();
          leavesRef.current!.setMatrixAt(slot, _dummy.matrix);

          // ── Branches (only for big trees) ──
          if (branchRef.current) {
            if (isBig) {
              _treePoolObj.position.set(tree.position[0], tree.position[1] + (2 * scale), tree.position[2]);
              _treePoolObj.scale.set(scale, scale, scale);
              _treePoolObj.rotation.set(0, 0, 0);
              _treePoolObj.updateMatrix();
              _treePoolObj.updateMatrixWorld(true);

              BRANCH_CONFIGS.forEach((config, bIdx) => {
                const b = _branchPoolObjs[bIdx];
                b.position.set(config.pos[0] / 2.8, config.pos[1] / 2.8, config.pos[2] / 2.8);
                b.quaternion.set(config.quat[0], config.quat[1], config.quat[2], config.quat[3]);
                const branchScale = config.scale[0] * (0.1 + 0.9 * (1 - currentLeavesScale));
                b.scale.set(branchScale, branchScale, branchScale);
                b.updateMatrix();
                b.matrixWorld.multiplyMatrices(_treePoolObj.matrixWorld, b.matrix);
                branchRef.current!.setMatrixAt(slot * NUM_BRANCHES + bIdx, b.matrixWorld);
              });
            } else {
              // Hide branches for small / sapling trees
              for (let bIdx = 0; bIdx < NUM_BRANCHES; bIdx++) {
                branchRef.current!.setMatrixAt(slot * NUM_BRANCHES + bIdx, _hiddenMatrix);
              }
            }
          }

          slot++;
        }
        if (slot >= MAX_TREES) break;
      }
      if (slot >= MAX_TREES) break;
    }

    // ── Hide unused tail instances ──
    for (let i = slot; i < (lastTreeCount.current > slot ? lastTreeCount.current : slot); i++) {
      trunkRef.current!.setMatrixAt(i, _hiddenMatrix);
      leavesRef.current!.setMatrixAt(i, _hiddenMatrix);
      if (stumpRef.current) stumpRef.current!.setMatrixAt(i, _hiddenMatrix);
      if (branchRef.current) {
        for (let bIdx = 0; bIdx < NUM_BRANCHES; bIdx++) {
          branchRef.current!.setMatrixAt(i * NUM_BRANCHES + bIdx, _hiddenMatrix);
        }
      }
    }

    // Set counts to exactly the active tree count
    trunkRef.current.count = slot;
    leavesRef.current.count = slot;
    if (stumpRef.current) stumpRef.current.count = slot;
    if (branchRef.current) branchRef.current.count = slot * NUM_BRANCHES;
    lastTreeCount.current = slot;

    // Flag GPU uploads
    trunkRef.current.instanceMatrix.needsUpdate = true;
    leavesRef.current.instanceMatrix.needsUpdate = true;
    if (branchRef.current) branchRef.current.instanceMatrix.needsUpdate = true;
    if (stumpRef.current) stumpRef.current.instanceMatrix.needsUpdate = true;
    if (slot > 0) {
      trunkGeo.attributes.aWhittle.needsUpdate = true;
      leavesGeo.attributes.aDissolve.needsUpdate = true;
    }

    // If dissolving in progress, force re-render next frame
    if (keepAnimating) {
      floraStampsRef.current.clear(); // force dirty
    }
  });

  return (
    <group>
      <instancedMesh ref={trunkRef} args={[trunkGeo, trunkMat, MAX_TREES]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={leavesRef} args={[leavesGeo, leavesMat, MAX_TREES]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={branchRef} args={[branchGeo, trunkMat, MAX_TREES * NUM_BRANCHES]} castShadow receiveShadow frustumCulled={false} />
      <instancedMesh ref={stumpRef} args={[stumpGeo, stumpMat, MAX_TREES]} castShadow receiveShadow frustumCulled={false} />
    </group>
  );
}
