import { WaterEngine } from './src/utils/WaterEngine';
import { getBaseTerrainHeight } from './src/utils/terrain';

const TEST_WORLD_Z = -100;
const engineA = new WaterEngine();
engineA.size = 80;
engineA.originX = 0;
engineA.originZ = TEST_WORLD_Z;

// Fake initRealTerrain
for(let x=0; x<80; x++){
  for(let z=0; z<80; z++){
    engineA.T_base[x + z*80] = 0; // fake flat
  }
}

const offsetsA: Record<string, number> = {};
for(let x=-20; x<=20; x++) { 
    offsetsA[`${x},${TEST_WORLD_Z}`] = 6; 
} 
engineA.updateTerrain([], []);

let foundDam = false;
for(let i=0; i<80*80; i++) {
   if (engineA.T[i] > engineA.T_base[i] + 0.5) foundDam = true;
}
console.log("Dam applied?", foundDam);

