import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CHUNK_SIZE, getTerrainHeight } from '../utils/terrain';
import { floraCache, FloraItem } from '../utils/floraCache';
import { useGameStore } from '../store';
import { getGlobalStamp } from '../utils/terrainOffsets';
import { waterEngine } from '../utils/WaterEngine';

const dummy = new THREE.Object3D();
const HIDDEN_MATRIX = new THREE.Matrix4().makeTranslation(0, -1000, 0).scale(new THREE.Vector3(0, 0, 0));
const REGION_SIZE = 120;

// ─── Shared stamp that GlobalFlora bumps on every rebuild ───
// RegionalLilies/Cattails poll this inside useFrame to detect
// changes WITHOUT relying on React prop diffing or closure capture.
let _globalFloraStamp = 0;

// ─── Shared region data written by GlobalFlora.render(), read by useFrame ───
let _lilyRegionData = new Map<string, FloraItem[]>();
let _cattailRegionData = new Map<string, FloraItem[]>();

export function rebuildRegionData() {
  const lRegions = new Map<string, FloraItem[]>();
  const cRegions = new Map<string, FloraItem[]>();

  floraCache.getAllChunks().forEach(chunkFlora => {
    chunkFlora.forEach((item: FloraItem) => {
      const rx = Math.floor(item.position[0] / REGION_SIZE);
      const rz = Math.floor(item.position[2] / REGION_SIZE);
      const rKey = `${rx}_${rz}`;

      if (item.type === 'lily') {
        if (!lRegions.has(rKey)) lRegions.set(rKey, []);
        lRegions.get(rKey)!.push(item);
      } else if (item.type === 'cattail') {
        if (!cRegions.has(rKey)) cRegions.set(rKey, []);
        cRegions.get(rKey)!.push(item);
      }
    });
  });

  _lilyRegionData = lRegions;
  _cattailRegionData = cRegions;
  _globalFloraStamp++;
}

function RegionalLilies({ regionKey, geometry, material }: { regionKey: string, geometry: THREE.BufferGeometry, material: THREE.Material }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const lastStamp = useRef(-1);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const dt = Math.min(delta, 0.1);

    // Read items directly from the shared module-level map — bypasses
    // React closure staleness entirely.
    const items = _lilyRegionData.get(regionKey) || [];

    // ── Dirty check: rebuild when global stamp changes ──
    const needsRebuild = lastStamp.current !== _globalFloraStamp;
    if (needsRebuild) {
      lastStamp.current = _globalFloraStamp;
      const renderCount = Math.min(items.length, 500);

      meshRef.current.count = renderCount;

      for (let i = renderCount; i < 500; i++) {
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

    for (let i = 0; i < items.length; i++) {
        const l = items[i];

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

  return <instancedMesh frustumCulled={false} ref={meshRef} args={[geometry, material, 500]} />;
}

function RegionalCattails({ regionKey, stalkGeo, headGeo, stalkMat, headMat }: { regionKey: string, stalkGeo: THREE.BufferGeometry, headGeo: THREE.BufferGeometry, stalkMat: THREE.Material, headMat: THREE.Material }) {
  const stalkRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  const lastStamp = useRef(-1);

  useFrame(() => {
    if (!stalkRef.current || !headRef.current) return;

    const items = _cattailRegionData.get(regionKey) || [];

    if (lastStamp.current === _globalFloraStamp) return;
    lastStamp.current = _globalFloraStamp;

    const renderCount = Math.min(items.length, 500);

    stalkRef.current.count = renderCount;
    headRef.current.count = renderCount;

    for (let i = renderCount; i < 500; i++) {
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
      if (isNaN(c.position[0]) || isNaN(c.position[1]) || isNaN(c.position[2])) {
        c.position[1] = 0;
      }

      dummy.position.set(c.position[0], c.position[1] + 1.5, c.position[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      stalkRef.current.setMatrixAt(i, dummy.matrix);

      dummy.position.set(c.position[0], c.position[1] + 3.2, c.position[2]);
      dummy.updateMatrix();
      headRef.current.setMatrixAt(i, dummy.matrix);
    }

    stalkRef.current.instanceMatrix.needsUpdate = true;
    headRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh frustumCulled={false} ref={stalkRef} args={[stalkGeo, stalkMat, 500]} />
      <instancedMesh frustumCulled={false} ref={headRef} args={[headGeo, headMat, 500]} />
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

  // Region keys determine which Regional* components mount.
  // We derive them from the shared data so React can diff the tree.
  const lilyKeys = useMemo(() => Array.from(_lilyRegionData.keys()), [ecologyStamp]);
  const cattailKeys = useMemo(() => Array.from(_cattailRegionData.keys()), [ecologyStamp]);

  const { lilyGeo, lilyMat, cattailStalkGeo, cattailHeadGeo, cattailStalkMat, cattailHeadMat } = useMemo(() => {
    const lilyGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.05, 8);
    const lilyMat = new THREE.MeshStandardMaterial({ color: '#2ecc71', roughness: 0.9 });
    const cattailStalkGeo = new THREE.CylinderGeometry(0.08, 0.1, 3.0, 5);
    const cattailStalkMat = new THREE.MeshStandardMaterial({ color: '#27ae60' });
    const cattailHeadGeo = new THREE.CylinderGeometry(0.2, 0.15, 0.6, 6);
    const cattailHeadMat = new THREE.MeshStandardMaterial({ color: '#8b4513' });
    return { lilyGeo, lilyMat, cattailStalkGeo, cattailHeadGeo, cattailStalkMat, cattailHeadMat };
  }, []);

  return (
    <group>
      {lilyKeys.map(key => (
         <RegionalLilies key={`lily-${key}`} regionKey={key} geometry={lilyGeo} material={lilyMat} />
      ))}
      {cattailKeys.map(key => (
         <RegionalCattails key={`cat-${key}`} regionKey={key} stalkGeo={cattailStalkGeo} headGeo={cattailHeadGeo} stalkMat={cattailStalkMat} headMat={cattailHeadMat} />
      ))}
    </group>
  );
}
