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
import { LightingSystem } from './LightingSystem';
import { PerfProbe, PerfOverlayUI } from './PerfOverlay';
import { getGraphicsConfig } from '../utils/qualityTier';

export function Game() {
  const showStats = useGameStore(state => state.settings.showStatsOverlay);
  const gfx = getGraphicsConfig();

  return (
    <>
      <Canvas shadows={gfx.shadowsEnabled} camera={{ position: [0, 10, 20], fov: 60 }} gl={{ antialias: gfx.antiAlias }}>
        {showStats && <PerfProbe />}
        <fog attach="fog" args={['#87a96b', gfx.fogNear, gfx.fogFar]} />
        <Suspense fallback={null}>
          {gfx.useEnvironmentMap ? (
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
      {showStats && <PerfOverlayUI />}
    </>
  );
}
