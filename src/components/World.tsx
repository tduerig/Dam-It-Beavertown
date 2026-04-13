import { useEffect } from 'react';
import { useGameStore } from '../store';
import { CHUNK_SIZE } from '../utils/terrain';
import { Chunk } from './Chunk';
import { GlobalFlora } from './GlobalFlora';
import { DraggableLogs } from './DraggableLogs';
import { MergedTerrain } from './MergedTerrain';

import { Particles } from './Particles';
import { getRenderConfig } from '../utils/qualityTier';

export function World() {
  // Only re-render chunks when the player crosses a 40-meter threshold boundary natively
  const chunkCoords = useGameStore(state => {
    return `${Math.floor(state.playerPosition[0] / CHUNK_SIZE)},${Math.floor(state.playerPosition[2] / CHUNK_SIZE)}`;
  });
  
  const [chunkXStr, chunkZStr] = chunkCoords.split(',');
  const chunkX = parseInt(chunkXStr, 10);
  const chunkZ = parseInt(chunkZStr, 10);

  const chunks = [];
  const viewDistance = getRenderConfig().chunkViewDistance;
  for (let x = -viewDistance; x <= viewDistance; x++) {
    for (let z = -viewDistance; z <= viewDistance; z++) {
      chunks.push(<Chunk key={`${chunkX + x}_${chunkZ + z}`} chunkX={chunkX + x} chunkZ={chunkZ + z} />);
    }
  }

  useEffect(() => {
    // Initial bloom on spawn so the world isn't totally barren!
    setTimeout(() => {
        useGameStore.getState().triggerEcologyTick();
    }, 2000);
  }, []);

  return (
    <group>
      <MergedTerrain />
      {chunks}
      <GlobalFlora />
      <DraggableLogs />
      <Particles />
    </group>
  );
}
