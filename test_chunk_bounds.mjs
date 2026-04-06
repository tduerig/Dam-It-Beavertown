function markChunksDirty(minX, maxX, CHUNK_SIZE) {
  const dirtyChunks = [];
  // A vertex at exact chunk boundary (e.g., 20) belongs to both chunk 0 and 1.
  // We expand the bounds slightly to ensure we catch edge-sharing chunks.
  const chunkMinX = Math.floor((minX + CHUNK_SIZE / 2 - 1) / CHUNK_SIZE);
  const chunkMaxX = Math.floor((maxX + CHUNK_SIZE / 2 + 1) / CHUNK_SIZE);
  for (let c = chunkMinX; c <= chunkMaxX; c++) {
    dirtyChunks.push(c);
  }
  return dirtyChunks;
}

// In Chunk.tsx, Chunk X's bounding box in world space is:
function getChunkBounds(chunkX, CHUNK_SIZE) {
  // PlaneGeometry goes from -CHUNK_SIZE/2 to +CHUNK_SIZE/2
  // Then positioned at chunkX * CHUNK_SIZE.
  const lowerBound = chunkX * CHUNK_SIZE - CHUNK_SIZE / 2;
  const upperBound = chunkX * CHUNK_SIZE + CHUNK_SIZE / 2;
  return [lowerBound, upperBound];
}

console.log("TESTING AP-3 (Terrain Cache) Bounding Bug:");

const CHUNK_SIZE = 40;
// Simulate digging mud at x=22, radius=3
const digX = 22;
const radius = 3;
const minX = digX - radius; // 19
const maxX = digX + radius; // 25

const dirtyChunks = markChunksDirty(minX, maxX, CHUNK_SIZE);

// Check if the modified coordinates actually fall within the chunks marked dirty
let failed = false;
for (let x = minX; x <= maxX; x++) {
  // Find which chunk actually holds the vertex at 'x'
  let actualChunkForX = null;
  for (let cx = -5; cx <= 5; cx++) {
    const [lower, upper] = getChunkBounds(cx, CHUNK_SIZE);
    if (x >= lower && x <= upper) {
      actualChunkForX = cx;
      break;
    }
  }

  if (!dirtyChunks.includes(actualChunkForX)) {
    console.error(`BUG DETECTED: Coordinate ${x} was modified. It belongs to Chunk ${actualChunkForX}, but dirty chunks are only [${dirtyChunks}]`);
    failed = true;
  }
}

if (failed) {
  process.exit(1);
} else {
  console.log("PASSED: All modified coordinates are within the dirty chunks.");
}
