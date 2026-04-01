import { useGameStore } from '../store';
import { CHUNK_SIZE } from '../utils/terrain';
import { Chunk } from './Chunk';
import { DraggableLogs } from './DraggableLogs';

import { Particles } from './Particles';

export function World() {
  const playerPos = useGameStore(state => state.playerPosition);
  const chunkX = Math.floor(playerPos[0] / CHUNK_SIZE);
  const chunkZ = Math.floor(playerPos[2] / CHUNK_SIZE);

  const chunks = [];
  const viewDistance = 3; // 7x7 grid for infinite terrain feel
  for (let x = -viewDistance; x <= viewDistance; x++) {
    for (let z = -viewDistance; z <= viewDistance; z++) {
      chunks.push(<Chunk key={`${chunkX + x}_${chunkZ + z}`} chunkX={chunkX + x} chunkZ={chunkZ + z} />);
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
