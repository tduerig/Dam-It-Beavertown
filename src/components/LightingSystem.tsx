import React, { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useGameStore } from '../store';
import { Platform } from 'react-native';
import * as THREE from 'three';
import { getGraphicsConfig } from '../utils/qualityTier';

const envColorDay = new THREE.Color('#87a96b');
const envColorNight = new THREE.Color('#1a2421');

export function LightingSystem() {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const { gl } = useThree();
  const timeOfDay = useGameStore(state => state.timeOfDay);
  const updateTimeOfDay = useGameStore(state => state.updateTimeOfDay);
  const lastHourRef = useRef(-1);

  // Manual tick for game loop time
  useFrame((state, delta) => {
    if (useGameStore.getState().gameState === 'playing') {
      updateTimeOfDay(delta);
    }
    
    // Discretize into 24 hours
    const currentHour = Math.floor(timeOfDay * 24);
    const discreteTime = currentHour / 24;
    
    // Explicit static shadowing control (The 4.1 Optimization refactored natively to hourly jumps)
    if (gl.shadowMap) {
      gl.shadowMap.autoUpdate = false;
      if (currentHour !== lastHourRef.current) {
          lastHourRef.current = currentHour;
          gl.shadowMap.needsUpdate = true; // Instantly bake the shadow exactly once this hour
      }
    }

    if (!lightRef.current) return;

    // Time of day logic (0 to 1)
    // 0-0.75 is Day. 0.75-0.85 Dusk. 0.85-0.95 Night. 0.95-1.0 Dawn.
    
    let sunAngle = 0;
    let intensity = 1.5;
    
    if (discreteTime < 0.75) {
        // Day orbital sweep
        const dayProgress = discreteTime / 0.75; // 0 to 1
        sunAngle = Math.PI * dayProgress;
        intensity = 1.5;
    } else if (discreteTime < 0.85) {
        // Dusk transition fading out
        const duskProgress = (discreteTime - 0.75) / 0.10;
        sunAngle = Math.PI + (Math.PI / 4) * duskProgress; 
        intensity = Math.max(0.1, 1.5 * (1 - duskProgress));
    } else if (discreteTime < 0.95) {
        // Deep Night
        sunAngle = Math.PI * 1.5;
        intensity = 0.1;
    } else {
        // Dawn transition arriving
        const dawnProgress = (discreteTime - 0.95) / 0.05;
        sunAngle = - (Math.PI / 4) * (1 - dawnProgress);
        intensity = 0.1 + (1.4 * dawnProgress);
    }

    // Map angle to X/Y trajectory
    const radius = 60;
    const x = Math.cos(sunAngle) * radius;
    const y = Math.max(0, Math.sin(sunAngle) * radius);
    const z = Math.cos(sunAngle) * (radius / 2); // Slight Z wobble offset
    
    lightRef.current.position.set(x, y + 10, z + 20);
    lightRef.current.intensity = intensity;
    
    // Smoothly interpolate background ambient sky color natively without reloading presets
    const gfx = getGraphicsConfig();
    if (!gfx.useEnvironmentMap) {
        const bg = state.scene.background;
        if (bg instanceof THREE.Color) {
            bg.lerpColors(envColorNight, envColorDay, Math.min(1, intensity / 1.5));
        }
    } else {
        if (state.scene.fog) {
            state.scene.fog.color.lerpColors(envColorNight, envColorDay, Math.min(1, intensity / 1.5));
        }
    }
  });

  const gfxConfig = getGraphicsConfig();

  return (
    <>
      <ambientLight intensity={gfxConfig.shadowsEnabled ? 0.3 : 0.6} />
      <directionalLight
        ref={lightRef}
        castShadow={gfxConfig.shadowsEnabled}
        position={[50, 50, 50]}
        intensity={1.5}
        shadow-mapSize-width={gfxConfig.shadowMapSize}
        shadow-mapSize-height={gfxConfig.shadowMapSize}
        shadow-camera-far={120}
        shadow-camera-left={-60}
        shadow-camera-right={60}
        shadow-camera-top={60}
        shadow-camera-bottom={-60}
      />
    </>
  );
}
