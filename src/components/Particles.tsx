import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useGameStore } from '../store';

const PARTICLE_COUNT = 20;
const LIFETIME = 1.0;

export function Particles() {
  const emitters = useGameStore(state => state.particleEmitters);
  const removeEmitter = useGameStore(state => state.removeParticleEmitter);
  
  const meshRef = useRef<THREE.InstancedMesh>(null);
  
  const { geo, mat } = useMemo(() => ({
    geo: new THREE.BoxGeometry(0.2, 0.2, 0.2),
    mat: new THREE.MeshStandardMaterial({ color: '#D2B48C' }) // Sawdust color
  }), []);

  // Store particle data: [x, y, z, vx, vy, vz, life, emitterId]
  const particles = useRef<any[]>([]);

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    
    // Add new particles for new emitters
    emitters.forEach(emitter => {
      if (!particles.current.some(p => p.emitterId === emitter.id)) {
        for (let i = 0; i < PARTICLE_COUNT; i++) {
          particles.current.push({
            emitterId: emitter.id,
            pos: new THREE.Vector3(...emitter.position),
            vel: new THREE.Vector3(
              (Math.random() - 0.5) * 8,
              Math.random() * 5 + 2,
              (Math.random() - 0.5) * 8
            ),
            life: LIFETIME * (0.5 + Math.random() * 0.5),
            color: new THREE.Color(emitter.color)
          });
        }
        // Remove emitter from store after spawning
        setTimeout(() => removeEmitter(emitter.id), 100);
      }
    });
    
    // Update particles
    const dummy = new THREE.Object3D();
    let instanceCount = 0;
    
    for (let i = particles.current.length - 1; i >= 0; i--) {
      const p = particles.current[i];
      p.life -= delta;
      
      if (p.life <= 0) {
        particles.current.splice(i, 1);
        continue;
      }
      
      p.vel.y -= 15 * delta; // Gravity
      p.pos.addScaledVector(p.vel, delta);
      
      dummy.position.copy(p.pos);
      const scale = p.life / LIFETIME;
      dummy.scale.set(scale, scale, scale);
      dummy.rotation.x += p.vel.x * delta;
      dummy.rotation.y += p.vel.y * delta;
      dummy.updateMatrix();
      
      meshRef.current.setMatrixAt(instanceCount, dummy.matrix);
      meshRef.current.setColorAt(instanceCount, p.color);
      instanceCount++;
    }
    
    meshRef.current.count = instanceCount;
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) {
      meshRef.current.instanceColor.needsUpdate = true;
    }
  });

  return (
    <instancedMesh ref={meshRef} args={[geo, mat, 1000]} castShadow frustumCulled={false} />
  );
}
