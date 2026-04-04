import { useGameStore } from '../store';
import { CHUNK_SIZE } from '../utils/terrain';
import { Chunk } from './Chunk';
import { ChunkFlora } from './ChunkFlora';
import { DraggableLogs } from './DraggableLogs';

import { Particles } from './Particles';

export function World() {
  // Only re-render chunks when the player crosses a 40-meter threshold boundary natively
  const chunkCoords = useGameStore(state => {
    return `${Math.floor(state.playerPosition[0] / CHUNK_SIZE)},${Math.floor(state.playerPosition[2] / CHUNK_SIZE)}`;
  });
  
  const [chunkXStr, chunkZStr] = chunkCoords.split(',');
  const chunkX = parseInt(chunkXStr, 10);
  const chunkZ = parseInt(chunkZStr, 10);

  const chunks = [];
  const viewDistance = 3; // 7x7 grid for infinite terrain feel
  for (let x = -viewDistance; x <= viewDistance; x++) {
    for (let z = -viewDistance; z <= viewDistance; z++) {
      chunks.push(<Chunk key={`${chunkX + x}_${chunkZ + z}`} chunkX={chunkX + x} chunkZ={chunkZ + z} />);
      chunks.push(<ChunkFlora key={`flora_${chunkX + x}_${chunkZ + z}`} chunkX={chunkX + x} chunkZ={chunkZ + z} />);
    }
  }

  return (
    <group>
      {chunks}
      <DraggableLogs />
      <Particles />
    </group>
  );
}
