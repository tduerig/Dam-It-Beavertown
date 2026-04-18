import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CHUNK_SIZE, getTerrainHeight } from '../utils/terrain';
import { floraCache, FloraItem } from '../utils/floraCache';
import { useGameStore } from '../store';
import { getGlobalStamp } from '../utils/terrainOffsets';
import { waterEngine } from '../utils/WaterEngine';
import { createMaterial } from '../utils/qualityTier';

const dummy = new THREE.Object3D();
const HIDDEN_MATRIX = new THREE.Matrix4().makeTranslation(0, -1000, 0).scale(new THREE.Vector3(0, 0, 0));
const REGION_SIZE = 120;

// ─── Shared data written by GlobalFlora.render(), read by useFrame ───
let _globalFloraStamp = 0;
let _allLilies: FloraItem[] = [];
let _allCattails: FloraItem[] = [];

export function rebuildRegionData() {
  const lAll: FloraItem[] = [];
  const cAll: FloraItem[] = [];

  floraCache.getAllChunks().forEach(chunkFlora => {
    chunkFlora.forEach((item: FloraItem) => {
      if (item.type === 'lily') {
         lAll.push(item);
      } else if (item.type === 'cattail') {
         cAll.push(item);
      }
    });
  });

  _allLilies = lAll;
  _allCattails = cAll;
  _globalFloraStamp++;
}

function GlobalLilies({ geometry, material }: { geometry: THREE.BufferGeometry, material: THREE.Material }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const lastStamp = useRef(-1);
  const MAX_GLOBAL_LILIES = 2500;

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const dt = Math.min(delta, 0.1);

    // Read items directly from the shared module-level array
    const items = _allLilies;

    // ── Dirty check: rebuild when global stamp changes ──
    const needsRebuild = lastStamp.current !== _globalFloraStamp;
    if (needsRebuild) {
      lastStamp.current = _globalFloraStamp;
      const renderCount = Math.min(items.length, MAX_GLOBAL_LILIES);

      meshRef.current.count = renderCount;

      for (let i = renderCount; i < MAX_GLOBAL_LILIES; i++) {
        meshRef.current.setMatrixAt(i, HIDDEN_MATRIX);
      }

      for (let i = 0; i < renderCount; i++) {
        const l = items[i];
        if (isNaN(l.position[0]) || isNaN(l.position[1]) || isNaN(l.position[2])) {
          l.position[1] = 0;
        }
        dummy.position.set(l.position[0], l.position[1], l.position[2]);
        dummy.rotation.set(0, (i * 1.5) % Math.PI, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(i, dummy.matrix);
      }

      meshRef.current.instanceMatrix.needsUpdate = true;
      if (renderCount === 0) return;
    }

    // ── Per-frame water-drift animation ──
    if (items.length === 0) return;
    let needsUpdate = false;
    const playerPos = useGameStore.getState().playerPosition;

    for (let i = 0; i < items.length; i++) {
        const l = items[i];
        
        // Distance Culling: Bypasses expensive terrain hash polling for distant clusters
        const dx = l.position[0] - playerPos[0];
        const dz = l.position[2] - playerPos[2];
        if (dx * dx + dz * dz > 3600) continue;

        const surfaceH = waterEngine.getSurfaceHeight(l.position[0], l.position[2]);
        const terrainH = getTerrainHeight(l.position[0], l.position[2]);
        const targetY = Math.max(terrainH, surfaceH);

        const vel = waterEngine.getVelocity(l.position[0], l.position[2]);
        const speed = Math.sqrt(vel.x * vel.x + vel.z * vel.z);

        let moved = false;
        if (speed > 1.2) {
            l.position[0] += vel.x * dt * 0.8;
            l.position[2] += vel.z * dt * 0.8;
            moved = true;
        }

        const yDiff = targetY - l.position[1];
        if (Math.abs(yDiff) > 0.02) {
           l.position[1] += yDiff * dt * 5.0;
           moved = true;
        }

        if (moved) {
            if (!isNaN(l.position[1])) {
                dummy.position.set(l.position[0], l.position[1], l.position[2]);
                dummy.rotation.set(0, (i * 1.5) % Math.PI, 0);
                dummy.scale.setScalar(1);
                dummy.updateMatrix();
                meshRef.current!.setMatrixAt(i, dummy.matrix);
                needsUpdate = true;
            }
        }
    }

    if (needsUpdate) {
        meshRef.current!.instanceMatrix.needsUpdate = true;
    }
  });

  const localGeo = useMemo(() => {
    const geo = geometry.clone();
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 5000);
    return geo;
  }, [geometry]);

  return <instancedMesh frustumCulled={true} ref={meshRef} args={[localGeo, material, MAX_GLOBAL_LILIES]} />;
}

function GlobalCattails({ stalkGeo, headGeo, stalkMat, headMat }: { stalkGeo: THREE.BufferGeometry, headGeo: THREE.BufferGeometry, stalkMat: THREE.Material, headMat: THREE.Material }) {
  const stalkRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const lastStamp = useRef(-1);
  const MAX_GLOBAL_CATTAILS = 2500;

  useFrame(() => {
    if (!stalkRef.current || !headRef.current) return;

    const items = _allCattails;

    if (lastStamp.current === _globalFloraStamp) return;
    lastStamp.current = _globalFloraStamp;

    const renderCount = Math.min(items.length, MAX_GLOBAL_CATTAILS);

    stalkRef.current.count = renderCount;
    headRef.current.count = renderCount;

    for (let i = renderCount; i < MAX_GLOBAL_CATTAILS; i++) {
      stalkRef.current.setMatrixAt(i, HIDDEN_MATRIX);
      headRef.current.setMatrixAt(i, HIDDEN_MATRIX);
    }

    if (renderCount === 0) {
      stalkRef.current.instanceMatrix.needsUpdate = true;
      headRef.current.instanceMatrix.needsUpdate = true;
      return;
    }

    for (let i = 0; i < renderCount; i++) {
      const c = items[i];
      const terrainY = getTerrainHeight(c.position[0], c.position[2]);
      c.position[1] = terrainY;

      dummy.position.set(c.position[0], terrainY + 1.5, c.position[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      stalkRef.current.setMatrixAt(i, dummy.matrix);

      dummy.position.set(c.position[0], terrainY + 3.2, c.position[2]);
      dummy.updateMatrix();
      headRef.current.setMatrixAt(i, dummy.matrix);
    }

    stalkRef.current.instanceMatrix.needsUpdate = true;
    headRef.current.instanceMatrix.needsUpdate = true;
  });

  const { localStalkGeo, localHeadGeo } = useMemo(() => {
    const sG = stalkGeo.clone();
    const hG = headGeo.clone();
    const sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 5000);
    sG.boundingSphere = sphere;
    hG.boundingSphere = sphere;
    return { localStalkGeo: sG, localHeadGeo: hG };
  }, [stalkGeo, headGeo]);

  return (
    <group>
      <instancedMesh frustumCulled={true} ref={stalkRef} args={[localStalkGeo, stalkMat, MAX_GLOBAL_CATTAILS]} />
      <instancedMesh frustumCulled={true} ref={headRef} args={[localHeadGeo, headMat, MAX_GLOBAL_CATTAILS]} />
    </group>
  );
}

export function GlobalFlora() {
  const ecologyStamp = useGameStore(s => s.ecologyStamp);

  // Rebuild the shared module-level region data whenever ecologyStamp changes.
  // This runs synchronously during render, BEFORE useFrame.
  useMemo(() => {
    rebuildRegionData();
  }, [ecologyStamp]);

  const { lilyGeo, lilyMat, cattailStalkGeo, cattailHeadGeo, cattailStalkMat, cattailHeadMat } = useMemo(() => {
    // ── Precompute Shared Flora Geometries & Materials ──
    const lilyGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.1, 8);
    const lilyMat = createMaterial({ color: '#2ecc71', roughness: 0.9 } as any);
    
    // Stalks (1st instanced mesh pair for cattails)
    const cattailStalkGeo = new THREE.CylinderGeometry(0.08, 0.1, 3.5, 6);
    const cattailStalkMat = createMaterial({ color: '#27ae60' });

    // Brown Heads (2nd instanced mesh pair for cattails)
    const cattailHeadGeo = new THREE.CylinderGeometry(0.2, 0.2, 1.2, 6);
    const cattailHeadMat = createMaterial({ color: '#8b4513' });
    return { lilyGeo, lilyMat, cattailStalkGeo, cattailHeadGeo, cattailStalkMat, cattailHeadMat };
  }, []);

  return (
    <group>
      <GlobalLilies geometry={lilyGeo} material={lilyMat} />
      <GlobalCattails stalkGeo={cattailStalkGeo} headGeo={cattailHeadGeo} stalkMat={cattailStalkMat} headMat={cattailHeadMat} />
    </group>
  );
}
