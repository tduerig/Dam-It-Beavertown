import { generateTreesForChunk } from '../src/utils/terrain';
import { floraCache } from '../src/utils/floraCache';
import { useGameStore } from '../src/store';

console.log("Testing interaction splicing...");
useGameStore.setState({ playerPosition: [0, 0, 0] });

// Generate
const trees = generateTreesForChunk(0, 0);
const initialLength = trees.length;
console.log("Initial trees in chunk [0,0]:", initialLength);

// Force insert a lily
const testLilyId = "testlily_123";
floraCache.add("0,0", { id: testLilyId, type: 'lily', position: [0, 5, 0] });
console.log("Trees after injection:", floraCache.get("0,0").length);

// Eat it
useGameStore.getState().eatSnack(testLilyId, "0,0");

console.log("Trees after eatSnack:", floraCache.get("0,0").length);

const found = floraCache.get("0,0").find(t => t.id === testLilyId);
if (found) {
    console.log("FATAL: Lily is still in floraCache!");
} else {
    console.log("SUCCESS: Lily mathematically removed from floraCache.");
}
