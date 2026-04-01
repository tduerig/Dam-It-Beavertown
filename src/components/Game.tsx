import { Canvas } from '@react-three/fiber';
import { Environment } from '@react-three/drei';
import { World } from './World';
import { Beaver } from './Beaver';
import { Dam } from './Dam';
import { Interaction } from './Interaction';
import { WaterRenderer } from './WaterRenderer';
import { RainRenderer } from './RainRenderer';
import { FloatingLogs } from './FloatingLogs';

export function Game() {
  return (
    <Canvas shadows camera={{ position: [0, 10, 20], fov: 60 }}>
      <fog attach="fog" args={['#87a96b', 30, 80]} />
      <Environment preset="forest" background />
      
      <ambientLight intensity={0.3} />
      <directionalLight
        castShadow
        position={[50, 50, 50]}
        intensity={1.5}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={100}
        shadow-camera-left={-50}
        shadow-camera-right={50}
        shadow-camera-top={50}
        shadow-camera-bottom={-50}
      />

      <World />
      <WaterRenderer />
      <RainRenderer />
      <Dam />
      <FloatingLogs />
      <Beaver />
      <Interaction />
    </Canvas>
  );
}
