import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CHUNK_SIZE, _treeCache } from '../utils/terrain';

const dummy = new THREE.Object3D();

export function ChunkFlora({ chunkX, chunkZ }: { chunkX: number, chunkZ: number }) {
  const cacheKey = `${chunkX},${chunkZ}`;
  
  // Natively bind to the raw cache instead of relying on explicit Zustand states
  // since the ecology sweeps update the cache object directly without rerendering World 
  // via deep states.
  const flora = useMemo(() => {
    const raw = _treeCache[cacheKey] || [];
    return raw.filter((item: any) => item.type === 'lily' || item.type === 'cattail');
  }, [chunkX, chunkZ, _treeCache[cacheKey]?.length]);

  const lilies = useMemo(() => flora.filter(f => f.type === 'lily'), [flora]);
  const cattails = useMemo(() => flora.filter(f => f.type === 'cattail'), [flora]);

  const { lilyGeo, lilyMat, cattailStalkGeo, cattailHeadGeo, cattailStalkMat, cattailHeadMat } = useMemo(() => {
    // Lily pads: flat green cylinder
    const lilyGeo = new THREE.CylinderGeometry(0.8, 0.8, 0.05, 8);
    const lilyMat = new THREE.MeshStandardMaterial({ color: '#2ecc71', roughness: 0.9 });
    
    // Cattail stalk: thin green cylinder
    const cattailStalkGeo = new THREE.CylinderGeometry(0.05, 0.05, 1.5, 4);
    const cattailStalkMat = new THREE.MeshStandardMaterial({ color: '#27ae60' });
    
    // Cattail head: brown capsule/cylinder
    const cattailHeadGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.4, 6);
    const cattailHeadMat = new THREE.MeshStandardMaterial({ color: '#8b4513' });
    
    return { lilyGeo, lilyMat, cattailStalkGeo, cattailHeadGeo, cattailStalkMat, cattailHeadMat };
  }, []);

  const lilyMeshRef = useRef<THREE.InstancedMesh>(null);
  const cattailStalkRef = useRef<THREE.InstancedMesh>(null);
  const cattailHeadRef = useRef<THREE.InstancedMesh>(null);

  useFrame(() => {
    if (lilyMeshRef.current && lilies.length > 0) {
      lilies.forEach((l, i) => {
        dummy.position.set(
          l.position[0] - chunkX * CHUNK_SIZE,
          l.position[1],
          l.position[2] - chunkZ * CHUNK_SIZE
        );
        dummy.rotation.set(0, (i * 1.5) % Math.PI, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        lilyMeshRef.current!.setMatrixAt(i, dummy.matrix);
      });
      lilyMeshRef.current.instanceMatrix.needsUpdate = true;
    }

    if (cattailStalkRef.current && cattailHeadRef.current && cattails.length > 0) {
      cattails.forEach((c, i) => {
        // Base coordinate
        const lx = c.position[0] - chunkX * CHUNK_SIZE;
        const ly = c.position[1];
        const lz = c.position[2] - chunkZ * CHUNK_SIZE;
        
        // Stalk
        dummy.position.set(lx, ly + 0.75, lz);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        cattailStalkRef.current!.setMatrixAt(i, dummy.matrix);
        
        // Head
        dummy.position.set(lx, ly + 1.2, lz);
        dummy.updateMatrix();
        cattailHeadRef.current!.setMatrixAt(i, dummy.matrix);
      });
      cattailStalkRef.current.instanceMatrix.needsUpdate = true;
      cattailHeadRef.current.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group position={[chunkX * CHUNK_SIZE, 0, chunkZ * CHUNK_SIZE]}>
      {lilies.length > 0 && (
        <instancedMesh ref={lilyMeshRef} args={[lilyGeo, lilyMat, lilies.length]} />
      )}
      {cattails.length > 0 && (
        <group>
          <instancedMesh ref={cattailStalkRef} args={[cattailStalkGeo, cattailStalkMat, cattails.length]} />
          <instancedMesh ref={cattailHeadRef} args={[cattailHeadGeo, cattailHeadMat, cattails.length]} />
        </group>
      )}
    </group>
  );
}
