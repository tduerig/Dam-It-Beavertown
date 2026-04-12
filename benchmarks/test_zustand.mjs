import { createStore } from 'zustand/vanilla';

// Mimic the size of the Beavertown store roots
const createLargeState = () => ({
  gameState: 'playing',
  inventory: { sticks: 10, mud: 10 },
  stats: {
    mudDug: 100, mudPatted: 100, treesDowned: 50, sticksPlaced: 50, 
    massiveTreesFelled: 5, maxWaterCoverage: 400, snacksEaten: 20
  },
  settings: {
    showStatsOverlay: false, physicsSubsteps: 2, reflectionsActive: false,
    quality: { simulation: 'low', graphics: 'low', rendering: 'low' }
  },
  placedBlocks: Array.from({ length: 100 }, (_, i) => ({ id: `block${i}`, position: [1,2,3], type: 'mud' })),
  draggableLogs: Array.from({ length: 50 }, (_, i) => ({ id: `log${i}`, position: [1,2,3], isDragged: false })),
  
  playerPosition: [0, 0, 0],
  playerRotation: 0,
  timeOfDay: 0.5,
  cameraAngle: 0,
  cameraPitch: 0.5,
  terrainStamp: 1,
  ecologyStamp: 1,

  setPlayerPosition: function(pos) { this.setState({ playerPosition: pos }); },
  updateTimeOfDay: function(dt) { this.setState((state) => ({ timeOfDay: state.timeOfDay + dt })); }
});

const store = createStore((set, get) => ({
  ...createLargeState(),
  setState: set,
}));

console.log("Starting Benchmark...");

// Test 1: 10,000 Zustand Dispatch Cycles (Simulating ~3 minutes of 60FPS playing)
const start1 = performance.now();
for (let i = 0; i < 10000; i++) {
  store.getState().setState({ playerPosition: [i, i, i] });
  store.getState().setState((state) => ({ timeOfDay: state.timeOfDay + 0.01 }));
}
const end1 = performance.now();

// Reset
store.setState(createLargeState());

// Test 2: In-place mutations (Simulating the same bounds)
const start2 = performance.now();
for (let i = 0; i < 10000; i++) {
  const st = store.getState();
  st.playerPosition[0] = i;
  st.playerPosition[1] = i;
  st.playerPosition[2] = i;
  st.timeOfDay += 0.01;
}
const end2 = performance.now();

console.log(JSON.stringify({
  zustandDispatchesMs: Math.round(end1 - start1),
  inPlaceMutationsMs: Math.round(end2 - start2),
  speedupMultiplier: ((end1 - start1) / (end2 - start2)).toFixed(2)
}, null, 2));

