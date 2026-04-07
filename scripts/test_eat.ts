import { floraCache } from '../src/utils/floraCache';
import { useGameStore } from '../src/store';
import { generateTreesForChunk } from '../src/utils/terrain';

// Setup Mock Environment
useGameStore.setState({ stats: { snacksEaten: 0 }, ecologyStamp: 0 });

console.log("Generating chunk...");
const trees = generateTreesForChunk(0, 0);
const initialLilies = trees.filter(t => t.type === 'lily');
console.log(`Spawned ${initialLilies.length} lilies. ID: ${initialLilies[0]?.id}`);

const id = initialLilies[0]?.id;
if (id) {
    console.log("Eating snack...");
    useGameStore.getState().eatSnack(id, "0,0");

    console.log("Checking cache...");
    const updated = floraCache.get("0,0");
    const found = updated.some(t => t.id === id);
    console.log(`Is lily still in cache? ${found}`);

    const stats = useGameStore.getState().stats;
    console.log(`Snacks Eaten count: ${stats.snacksEaten}`);
    
    // Simulate what Interaction.tsx does immediately after
    console.log("Re-running generation...");
    const treesAfter = generateTreesForChunk(0, 0);
    const foundAfter = treesAfter.some(t => t.id === id);
    console.log(`Is lily in generated items again? ${foundAfter}`);
    console.log(`Total items in chunk now: ${treesAfter.length} (was ${trees.length})`);
}
