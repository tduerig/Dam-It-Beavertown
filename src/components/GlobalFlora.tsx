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
const REGION_SIZE = 120; // 3x3 chunk groups (120x120) provides tight clustered culling with minimal draw calls

function RegionalLilies({ items, geometry, material }: { items: any[], geometry: THREE.BufferGeometry, material: THREE.Material }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  // Track previous items reference to detect when a rebuild is needed.
  // Using a ref instead of useEffect guarantees the rebuild happens INSIDE
  // the useFrame callback — i.e. BEFORE the draw call — eliminating the
  // stale-matrix ghosting window that useEffect left open.
  const lastItemsRef = useRef<any[] | null>(null);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    const dt = Math.min(delta, 0.1);

    // ── Dirty check: rebuild all matrices when items array changes ──
    const needsRebuild = lastItemsRef.current !== items;
    if (needsRebuild) {
      lastItemsRef.current = items;
      const renderCount = Math.min(items.length, 500);

      // Set draw count to active items — prevents GPU from drawing
      // degenerate triangles at stale buffer slots.
      meshRef.current.count = renderCount;

      // Belt-and-suspenders: also bury unused slots at Y=-1000
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
            // Swept upstream/downstream!
            l.position[0] += vel.x * dt * 0.8;
            l.position[2] += vel.z * dt * 0.8;
            moved = true;
        }
        
        const yDiff = targetY - l.position[1];
        if (Math.abs(yDiff) > 0.02) {
           l.position[1] += yDiff * dt * 5.0; // Float gently to surface
           moved = true;
        }
        
        if (moved) {
            // Guard NaN before matrix update
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

function RegionalCattails({ items, stalkGeo, headGeo, stalkMat, headMat }: { items: any[], stalkGeo: THREE.BufferGeometry, headGeo: THREE.BufferGeometry, stalkMat: THREE.Material, headMat: THREE.Material }) {
  const stalkRef = useRef<THREE.InstancedMesh>(null);
  const headRef = useRef<THREE.InstancedMesh>(null);
  // Same ref-based dirty tracking as RegionalLilies — guarantees matrix
  // rebuild happens before the draw call, not after it (useEffect ordering).
  const lastItemsRef = useRef<any[] | null>(null);

  useFrame(() => {
    if (!stalkRef.current || !headRef.current) return;

    // ── Dirty check: rebuild when items change ──
    if (lastItemsRef.current === items) return;
    lastItemsRef.current = items;

    const renderCount = Math.min(items.length, 500);

    // Set draw count to active items
    stalkRef.current.count = renderCount;
    headRef.current.count = renderCount;

    // Belt-and-suspenders: bury unused slots
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

      dummy.position.set(c.position[0], c.position[1] + 0.75, c.position[2]);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      stalkRef.current.setMatrixAt(i, dummy.matrix);

      dummy.position.set(c.position[0], c.position[1] + 1.2, c.position[2]);
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

  // Group flora into tight clustered regions (120x120 grids)
  const { lilyRegions, cattailRegions } = useMemo(() => {
    const lRegions = new Map<string, any[]>();
    const cRegions = new Map<string, any[]>();
    
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
    
    return { 
      lilyRegions: Array.from(lRegions.entries()), 
      cattailRegions: Array.from(cRegions.entries()) 
    };
  }, [ecologyStamp]);

  const { lilyGeo, lilyMat, cattailStalkGeo, cattailHeadGeo, cattailStalkMat, cattailHeadMat } = useMemo(() => {
    const lilyGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.05, 8);
    const lilyMat = new THREE.MeshStandardMaterial({ color: '#2ecc71', roughness: 0.9 });
    const cattailStalkGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.5, 4);
    const cattailStalkMat = new THREE.MeshStandardMaterial({ color: '#27ae60' });
    const cattailHeadGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.4, 6);
    const cattailHeadMat = new THREE.MeshStandardMaterial({ color: '#8b4513' });
    return { lilyGeo, lilyMat, cattailStalkGeo, cattailHeadGeo, cattailStalkMat, cattailHeadMat };
  }, []);

  return (
    <group>
      {lilyRegions.map(([key, items]) => (
         <RegionalLilies key={`lily-${key}`} items={items} geometry={lilyGeo} material={lilyMat} />
      ))}
      {cattailRegions.map(([key, items]) => (
         <RegionalCattails key={`cat-${key}`} items={items} stalkGeo={cattailStalkGeo} headGeo={cattailHeadGeo} stalkMat={cattailStalkMat} headMat={cattailHeadMat} />
      ))}
    </group>
  );
}
