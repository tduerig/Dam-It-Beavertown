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
import { BeaverBrain } from './BeaverBrain';
import { PerfProbe, PerfOverlayUI } from './PerfOverlay';
import { getGraphicsConfig } from '../utils/qualityTier';
import { StartScreenScene } from './StartScreenScene';

export function Game() {
  const showStats = useGameStore(state => state.settings.showStatsOverlay);
  const gameState = useGameStore(state => state.gameState);
  const gfx = getGraphicsConfig();

  return (
    <>
      <Canvas shadows={gfx.shadowsEnabled} camera={{ position: [0, 10, 20], fov: 60 }} gl={{ antialias: gfx.antiAlias, preserveDrawingBuffer: true }}>
        {showStats && <PerfProbe />}
        <fog attach="fog" args={['#87a96b', gfx.fogNear, gfx.fogFar]} />
        <Suspense fallback={null}>
          {gameState === 'start_menu' ? (
            <StartScreenScene />
          ) : (
            <>
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
              <BeaverBrain />
              <Interaction />
            </>
          )}
        </Suspense>
      </Canvas>
      {showStats && <PerfOverlayUI />}
    </>
  );
}
