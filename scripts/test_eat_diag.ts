import { floraCache, FloraItem } from '../src/utils/floraCache';

// Simulate what happens during the game lifecycle

// 1. Seed a chunk with some flora (like generateTreesForChunk does)
const chunkKey = '0,0';
const initialFlora: FloraItem[] = [
  { id: 'tree_0_0_1', position: [5, 2, 5], type: 'big' },
  { id: 'tree_0_0_2', position: [10, 2, 10], type: 'small' },
  { id: 'init_lily_0_0_3', position: [3, 1, 3], type: 'lily' },
  { id: 'init_lily_0_0_4', position: [7, 1, 7], type: 'lily' },
  { id: 'init_cat_0_0_5', position: [2, 0.5, 2], type: 'cattail' },
];
floraCache.set(chunkKey, initialFlora);

console.log('--- INITIAL STATE ---');
console.log('Cache items:', floraCache.get(chunkKey).length);
console.log('getAllChunks items:', floraCache.getAllChunks().flatMap(c => c).length);

// 2. Capture a reference (like generateTreesForChunk returns)
const capturedRef = floraCache.get(chunkKey);
console.log('\nCaptured ref length:', capturedRef.length);
console.log('Captured ref === cache entry:', capturedRef === floraCache.get(chunkKey));

// 3. Simulate eating lily_0_0_3 (like eatSnack does)
console.log('\n--- EATING init_lily_0_0_3 ---');
const removed = floraCache.remove(chunkKey, 'init_lily_0_0_3');
console.log('Remove returned:', removed);

// 4. Check what happened
console.log('\nCache items after remove:', floraCache.get(chunkKey).length);
console.log('Captured ref length after remove:', capturedRef.length, '(SHOULD BE 5 - stale!)');
console.log('Captured ref === cache entry after remove:', capturedRef === floraCache.get(chunkKey), '(SHOULD BE false!)');

const idsInCache = floraCache.get(chunkKey).map(f => f.id);
console.log('IDs in cache:', idsInCache);
console.log('Lily still in cache?', idsInCache.includes('init_lily_0_0_3'));

// 5. Simulate what generateTreesForChunk does on next call (with generatedChunks Set)
// It would call floraCache.get(chunkKey) and return that
const nextCall = floraCache.get(chunkKey);
console.log('\nNext generateTreesForChunk call length:', nextCall.length);
console.log('Lily in next call?', nextCall.some(f => f.id === 'init_lily_0_0_3'));

// 6. But what about getAllChunks (used by GlobalFlora useMemo)?
const allChunks = floraCache.getAllChunks();
const allItems = allChunks.flatMap(c => c);
console.log('\ngetAllChunks total items:', allItems.length);
console.log('Lily in getAllChunks?', allItems.some(f => f.id === 'init_lily_0_0_3'));

// 7. Simulate ecology adding via .add() — does this mutate the array or create a new one?
console.log('\n--- TESTING .add() behavior ---');
const beforeAdd = floraCache.get(chunkKey);
floraCache.add(chunkKey, { id: 'ecology_lily_1', position: [4, 1, 4], type: 'lily' });
const afterAdd = floraCache.get(chunkKey);
console.log('Before add ref === after add ref:', beforeAdd === afterAdd, '(if true, .add() mutates in-place!)');
console.log('Before add length:', beforeAdd.length, 'After add length:', afterAdd.length);

console.log('\n--- CONCLUSION ---');
if (beforeAdd === afterAdd) {
  console.log('BUG CONFIRMED: .add() mutates the array in-place, so GlobalFlora useMemo will');
  console.log('see the SAME array reference and RegionalLilies will NOT rebuild matrices!');
  console.log('But more importantly: .remove() creates a NEW array via .filter(), so the');
  console.log('old reference held by Chunk.tsx treesRef is STALE.');
} else {
  console.log('add() creates a new array. No mutation bug.');
}
