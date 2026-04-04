import { WaterEngine } from '../src/utils/WaterEngine';

const mockGameStore = {
  getState: () => ({
    terrainOffsets: {
      '0,0': -5, '1,0': -5, '0,1': -5, '1,1': -5,
      'update_flag': Date.now()
    }
  })
};

require('../src/store').useGameStore = mockGameStore;

async function runPrimitiveTests() {
  console.log('--- Primtive WaterEngine Test ---');
  const engine = new WaterEngine();
  engine.update(0, 0, [], [], 1/60, 0);

  const centerIdx = Math.floor(engine.size / 2) + Math.floor(engine.size / 2) * engine.size;
  console.log('Initial Grid:', 'T=', engine.T[centerIdx].toFixed(2), 'W=', engine.W[centerIdx].toFixed(2));

  for (let i = 0; i < 60; i++) {
    engine.update(0, 0, [], [], 1/60, 0);
  }

  console.log('After Flow:', 'T=', engine.T[centerIdx].toFixed(2), 'W=', engine.W[centerIdx].toFixed(2));
  if (engine.W[centerIdx] > 0 && engine.T[centerIdx] < -3) {
    console.log('SUCCESS: Water correctly flowed into depression!');
  } else {
    console.log('FAIL: Water did not pool correctly.');
  }
}

runPrimitiveTests();

