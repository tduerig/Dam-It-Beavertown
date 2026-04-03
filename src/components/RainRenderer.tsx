import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../store';

import { Platform } from 'react-native';

const RAIN_COUNT = Platform.OS === 'web' ? 5000 : 1000;

export function RainRenderer() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  
  // Store individual drop positions and speeds
  const drops = useMemo(() => {
    const arr = [];
    for (let i = 0; i < RAIN_COUNT; i++) {
      arr.push({
        x: (Math.random() - 0.5) * 100,
        y: Math.random() * 50,
        z: (Math.random() - 0.5) * 100,
        speed: 20 + Math.random() * 10
      });
    }
    return arr;
  }, []);

  useFrame((state, delta) => {
    const { rainIntensity, playerPosition } = useGameStore.getState();
    
    if (!meshRef.current) return;
    
    // Hide all drops if no rain
    if (rainIntensity <= 0) {
      meshRef.current.count = 0;
      return;
    }
    
    // Show drops proportional to intensity
    meshRef.current.count = Math.floor(RAIN_COUNT * rainIntensity);
    
    for (let i = 0; i < meshRef.current.count; i++) {
      const drop = drops[i];
      
      // Fall down
      drop.y -= drop.speed * delta;
      
      // Reset if hit ground (approximate)
      if (drop.y < -5) {
        drop.y = 40 + Math.random() * 10;
        // Re-center around player when resetting
        drop.x = playerPosition[0] + (Math.random() - 0.5) * 80;
        drop.z = playerPosition[2] + (Math.random() - 0.5) * 80;
      }
      
      dummy.position.set(drop.x, drop.y, drop.z);
      dummy.scale.set(0.05, 1.0, 0.05); // Thin, long drops
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, RAIN_COUNT]}>
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#88ccff" transparent opacity={0.4} />
    </instancedMesh>
  );
}
