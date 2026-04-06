import { propagateForest } from '../src/utils/ecology';
import { generateTreesForChunk } from '../src/utils/terrain';
import { floraCache } from '../src/utils/floraCache';
import { useGameStore } from '../src/store';
import { waterEngine } from '../src/utils/WaterEngine';

console.log("Starting Flora Math Simulation Test...");

// Initial state mock
useGameStore.setState({ playerPosition: [0, 0, 0] });

// Initialize Water engine
waterEngine.update(0, 0, [], [], 16.6); // Mount the cache

// Force chunk generation exactly like game start
console.log("Generating 3x3 Chunks...");
for(let x=-1; x<=1; x++) {
    for(let z=-1; z<=1; z++) {
        generateTreesForChunk(x, z);
    }
}

let lilies = 0;
let cats = 0;

console.log("Simulating 10 Days of Ecology...");
for(let d=0; d<10; d++) {
    propagateForest();
    
    lilies = 0; cats = 0;
    floraCache.getAllChunks().forEach(chunk => {
        chunk.forEach(t => {
            if (t.type === 'lily') lilies++;
            if (t.type === 'cattail') cats++;
        });
    });
    console.log(`Day ${d}: Lilies: ${lilies}, Cattails: ${cats}`);
}

// Dump exact positions for the first 3 lilies to verify NaN corruption!
let dumped = 0;
floraCache.getAllChunks().forEach(chunk => {
    chunk.forEach(t => {
        if (t.type === 'lily' && dumped < 3) {
            console.log(`[LILY-DUMP] Pos: ${t.position.join(', ')}`);
            dumped++;
        }
    });
});
