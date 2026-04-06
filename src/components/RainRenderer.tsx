import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../store';

import { getRenderConfig } from '../utils/qualityTier';

const RAIN_COUNT = getRenderConfig().rainCount;

export function RainRenderer() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  
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
    const count = Math.floor(RAIN_COUNT * rainIntensity);
    meshRef.current.count = count;
    
    // Direct Float32Array write — skip Object3D.updateMatrix() entirely.
    // Rain drops don't rotate, so the matrix is a simple scale+translate:
    // [sx, 0, 0, 0,  0, sy, 0, 0,  0, 0, sz, 0,  tx, ty, tz, 1]
    const array = meshRef.current.instanceMatrix.array as Float32Array;
    const sx = 0.05, sz = 0.05, sy = 1.0;
    
    for (let i = 0; i < count; i++) {
      const drop = drops[i];
      
      // Fall down
      drop.y -= drop.speed * delta;
      
      // Reset if hit ground
      if (drop.y < -5) {
        drop.y = 40 + Math.random() * 10;
        drop.x = playerPosition[0] + (Math.random() - 0.5) * 80;
        drop.z = playerPosition[2] + (Math.random() - 0.5) * 80;
      }
      
      // Write directly to the matrix array (column-major order)
      const off = i * 16;
      array[off]     = sx;  array[off + 1] = 0;   array[off + 2]  = 0;  array[off + 3]  = 0;
      array[off + 4] = 0;   array[off + 5] = sy;  array[off + 6]  = 0;  array[off + 7]  = 0;
      array[off + 8] = 0;   array[off + 9] = 0;   array[off + 10] = sz; array[off + 11] = 0;
      array[off + 12] = drop.x; array[off + 13] = drop.y; array[off + 14] = drop.z; array[off + 15] = 1;
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
