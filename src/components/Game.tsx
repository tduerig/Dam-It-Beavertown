import { Canvas } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import { World } from './World';
import { Beaver } from './Beaver';
import { Dam } from './Dam';
import { Interaction } from './Interaction';
import { WaterRenderer } from './WaterRenderer';
import { RainRenderer } from './RainRenderer';
import { FloatingLogs } from './FloatingLogs';
import { Suspense } from 'react';
import { Platform } from 'react-native';
import { useGameStore } from '../store';
import { Stats } from '@react-three/drei';
import { LightingSystem } from './LightingSystem';

export function Game() {
  const showStats = useGameStore(state => state.settings.showStatsOverlay);

  return (
    <Canvas shadows={Platform.OS === 'web'} camera={{ position: [0, 10, 20], fov: 60 }} gl={{ antialias: false }}>
      {showStats && <Stats className="stats-overlay" />}
      <fog attach="fog" args={['#87a96b', 30, 80]} />
      <Suspense fallback={null}>
        {Platform.OS === 'web' ? (
          <Environment preset="forest" background />
        ) : (
          <color attach="background" args={['#87a96b']} />
        )}
        
        <LightingSystem />

        <World />
        <WaterRenderer />
        <RainRenderer />
        <Dam />
        <FloatingLogs />
        <Beaver />
        <Interaction />
      </Suspense>
    </Canvas>
  );
}
