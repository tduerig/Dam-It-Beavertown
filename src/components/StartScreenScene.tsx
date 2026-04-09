import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Environment } from '@react-three/drei';

function StartScreenBeaver() {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const tailRef = useRef<THREE.Group>(null);
  const armLRef = useRef<THREE.Group>(null);
  const armRRef = useRef<THREE.Group>(null);

  useFrame((state, delta) => {
    if (!groupRef.current || !bodyRef.current || !headRef.current || !tailRef.current || !armLRef.current || !armRRef.current) return;

    const t = state.clock.elapsedTime * 6; // swimming speed

    // Rotate beaver slowly
    groupRef.current.rotation.y -= 0.6 * delta;
    
    // Bob up and down in water, offset by base Y height (e.g. 7)
    groupRef.current.position.y = 7 + Math.sin(t * 0.5) * 0.2;

    // Swimming animation
    bodyRef.current.rotation.z = Math.sin(t) * 0.15;
    headRef.current.rotation.z = -Math.sin(t) * 0.1;
    
    // Tail wags
    tailRef.current.rotation.y = Math.sin(t * 1.5) * 0.4;
    tailRef.current.rotation.x = -0.2 + Math.cos(t * 1.5) * 0.2;
    
    // Arms paddle
    armLRef.current.rotation.x = Math.sin(t) * 0.8;
    armRRef.current.rotation.x = Math.sin(t + Math.PI) * 0.8;
    
    // Surface swimming pitch
    bodyRef.current.rotation.x = Math.sin(t * 0.5) * 0.05 + 0.1; // Slight upward pitch
  });

  return (
    <group ref={groupRef} position={[0, 7, 0]} scale={[2.8, 2.8, 2.8]}>
      <group ref={bodyRef}>
        <mesh receiveShadow position={[0, 0, 0]}>
          <boxGeometry args={[1.2, 1.1, 1.6]} />
          <meshStandardMaterial color="#8B4513" />
        </mesh>
        
        <group ref={headRef} position={[0, 0.6, -0.8]}>
          <mesh receiveShadow position={[0, 0, 0]}>
            <boxGeometry args={[0.9, 0.9, 0.9]} />
            <meshStandardMaterial color="#A0522D" />
          </mesh>
          <mesh position={[-0.4, 0.45, 0]}>
            <sphereGeometry args={[0.2, 8, 8]} />
            <meshStandardMaterial color="#5C4033" />
          </mesh>
          <mesh position={[0.4, 0.45, 0]}>
            <sphereGeometry args={[0.2, 8, 8]} />
            <meshStandardMaterial color="#5C4033" />
          </mesh>
          <mesh position={[-0.25, 0.2, -0.45]}>
            <sphereGeometry args={[0.08, 8, 8]} />
            <meshStandardMaterial color="#000000" />
          </mesh>
          <mesh position={[0.25, 0.2, -0.45]}>
            <sphereGeometry args={[0.08, 8, 8]} />
            <meshStandardMaterial color="#000000" />
          </mesh>
          <mesh position={[0, 0, -0.5]}>
            <boxGeometry args={[0.4, 0.3, 0.2]} />
            <meshStandardMaterial color="#3E2723" />
          </mesh>
          <mesh position={[-0.08, -0.2, -0.55]}>
            <boxGeometry args={[0.12, 0.25, 0.05]} />
            <meshStandardMaterial color="#FFFFFF" />
          </mesh>
          <mesh position={[0.08, -0.2, -0.55]}>
            <boxGeometry args={[0.12, 0.25, 0.05]} />
            <meshStandardMaterial color="#FFFFFF" />
          </mesh>
        </group>

        <group ref={armLRef} position={[-0.65, -0.1, -0.5]}>
          <mesh receiveShadow position={[0, -0.2, 0]}>
            <boxGeometry args={[0.2, 0.5, 0.2]} />
            <meshStandardMaterial color="#5C4033" />
          </mesh>
        </group>
        <group ref={armRRef} position={[0.65, -0.1, -0.5]}>
          <mesh receiveShadow position={[0, -0.2, 0]}>
            <boxGeometry args={[0.2, 0.5, 0.2]} />
            <meshStandardMaterial color="#5C4033" />
          </mesh>
        </group>

        <group ref={tailRef} position={[0, -0.3, 0.8]} rotation={[-0.2, 0, 0]}>
          <mesh receiveShadow position={[0, 0, 0.6]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.15]}>
            <cylinderGeometry args={[0.5, 0.5, 1.2, 16]} />
            <meshStandardMaterial color="#2F4F4F" />
          </mesh>
        </group>
      </group>
    </group>
  );
}

function WaterEffect() {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame((state) => {
    if (meshRef.current) {
      const material = meshRef.current.material as THREE.MeshStandardMaterial;
      // Simple pan animation for water
      material.opacity = 0.85 + Math.sin(state.clock.elapsedTime * 2) * 0.05;
    }
  });

  return (
    <mesh ref={meshRef} position={[0, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[100, 100]} />
      <meshStandardMaterial 
        color="#4da6ff" 
        transparent 
        opacity={0.8} 
        roughness={0.1} 
      />
    </mesh>
  );
}

function CameraSetup() {
  useFrame(({ camera }) => {
    // Explicit camera to guarantee start screen framing
    camera.position.set(0, 5, 15);
    camera.lookAt(0, 5, 0);
  });
  return null;
}

export function StartScreenScene() {
  return (
    <>
      <CameraSetup />
      <fog attach="fog" args={['#bae6fd', 10, 30]} />
      <Environment preset="forest" />
      <ambientLight intensity={1.0} />
      <directionalLight position={[10, 20, 10]} intensity={1.5} />
      
      <StartScreenBeaver />
      <WaterEffect />
    </>
  );
}
