import { WaterEngine } from '../src/utils/WaterEngine';

// Mock react-native and expo globally
jest.mock('react-native', () => ({
  Platform: { OS: 'web' }
}));
jest.mock('expo', () => ({}));

// Mock the Zustand store so we can inject primitive terrains
jest.mock('../src/store', () => {
  let mockOffsets = {};
  return {
    useGameStore: {
      getState: () => ({
        terrainOffsets: mockOffsets
      })
    },
    // We add a helper to our mock module to let us inject arbitrary terrain manually
    __setMockOffsets: (offsets: any) => {
      mockOffsets = offsets;
    }
  };
});

describe('WaterEngine primitive physics', () => {
  let engine: WaterEngine;

  beforeEach(() => {
    engine = new WaterEngine();
    // Reduce size for faster primitive tests if we wanted, but WaterEngine uses WATER_SIZE constant.
    const { __setMockOffsets } = require('../src/store');
    __setMockOffsets({ 'update_flag': Date.now() });
  });

  it('should flow water down a dug hole and not leave a floating wall of water', () => {
    // 1. Initialize engine at origin (0, 0)
    engine.update(0, 0, [], [], 1/60, 0);

    // Get the center of the grid to test
    const centerX = Math.floor(engine.size / 2);
    const centerZ = Math.floor(engine.size / 2);
    const centerIdx = centerX + centerZ * engine.size;

    // 2. Identify the base terrain height and water height at center
    const initialT = engine.T[centerIdx];
    const initialW = engine.W[centerIdx];

    // 3. Dig a hole directly at the center by updating mock terrain offsets
    const { __setMockOffsets } = require('../src/store');
    
    // Create a 2x2 hole
    __setMockOffsets({
      '0,0': -5,
      '1,0': -5,
      '0,1': -5,
      '1,1': -5,
      'update_flag': Date.now()
    });

    // 4. Run update heavily to let water flow. Simulate 60 frames.
    for (let i = 0; i < 60; i++) {
      engine.update(0, 0, [], [], 1/60, 0);
    }

    // 5. Assertions
    const newT = engine.T[centerIdx];
    const newW = engine.W[centerIdx];

    // The terrain height MUST be lower than initialT
    expect(newT).toBeLessThan(initialT);

    // If water was "floating like a wall", it wouldn't exist down in the hole dynamically, 
    // or the grid wouldn't be updated.
    // The physics engine should compute flow into the depression!
    // Since water falls into the depression, the water depth `W` should be > 0.
    // In fact, if the hole is 5 meters deep, water should pool deeply.
    expect(newW).toBeGreaterThan(0);
    
    // We can also ensure the total absolute height (T + W) isn't just hovering.
    const absoluteHeight = newT + newW;
    expect(absoluteHeight).toBeLessThanOrEqual(initialT + initialW + 1.0); 

    console.log("Primitive physics successful! Water pooled correctly.");
    console.log(`Initial: Terrain=${initialT.toFixed(2)}, WaterDepth=${initialW.toFixed(2)}`);
    console.log(`After Hole: Terrain=${newT.toFixed(2)}, WaterDepth=${newW.toFixed(2)}`);
  });

  it('should flow water around a massive mud mound without clipping through it', () => {
    engine.update(0, 0, [], [], 1/60, 0);

    const centerX = Math.floor(engine.size / 2);
    const centerZ = Math.floor(engine.size / 2);
    const centerIdx = centerX + centerZ * engine.size;

    const initialT = engine.T[centerIdx];

    // Build a massive mud pillar using the explicit blocks array (like placing Mud via G key)
    const blocks = [{
      id: 'test_mud',
      type: 'mud' as const,
      position: [0, initialT + 10, 0] as [number, number, number],
      rotation: [0, 0, 0] as [number, number, number]
    }];

    for (let i = 0; i < 60; i++) {
      engine.update(0, 0, blocks, [], 1/60, 0);
    }

    const moundT = engine.T[centerIdx];
    const moundW = engine.W[centerIdx];

    // Terrain should spike by exactly the height of the Mud!
    // Engine sets it using `Math.max(..., by + 0.25)` for mud.
    expect(moundT).toBeGreaterThan(initialT + 5);

    // Because it's a massive pillar sticking out of the river, water should roll OFF of it.
    // Water depth `W` on top of the mound should effectively be 0 or extremely close to 0!
    expect(moundW).toBeLessThan(0.1);

    console.log("Primitive physics successful! Water displaced off the mound correctly.");
    console.log(`Mound: Terrain=${moundT.toFixed(2)}, WaterDepth=${moundW.toFixed(2)}`);
  });
});
