import fs from 'fs';
import ts from 'typescript';

const engineSrc = fs.readFileSync('./src/utils/WaterEngine.ts', 'utf8');
const trSrc = fs.readFileSync('./src/utils/terrain.ts', 'utf8');

const merged = `
${trSrc.replace(/export /g, '')}
${engineSrc.replace(/export /g, '').replace(/import .*;/g, '')}

// Simulate what water-test.tsx does
const WATER_SIZE = 160;
const TEST_WORLD_Z = 20;
const size = WATER_SIZE;
const half = WATER_SIZE / 2;

function initRealTerrain(engine) {
    for (let i = 0; i < size * size; i++) {
        const x = i % size;
        const z = Math.floor(i / size);
        const wx = engine.originX - half + x;
        const wz = engine.originZ - half + z;
        engine.T_base[i] = getBaseTerrainHeight(wx, wz);
    }
}

const engineA = new WaterEngine();
engineA.size = size; engineA.originX = 0; engineA.originZ = TEST_WORLD_Z;
engineA.W = new Float32Array(size * size);
engineA.T = new Float32Array(size * size);
engineA.T_base = new Float32Array(size * size);
initRealTerrain(engineA);

const offsetsA = {};
for(let x=-20; x<=20; x++) { offsetsA[\`\${x},\${TEST_WORLD_Z}\`] = 16; offsetsA[\`\${x},\${TEST_WORLD_Z+1}\`] = 16; } 
engineA.updateTerrain([], [], offsetsA);

const injectZ = TEST_WORLD_Z - half + 10;
console.log("River inject Z:", injectZ, "Center:", getRiverCenter(injectZ));
console.log("River dam Z:", TEST_WORLD_Z, "Center:", getRiverCenter(TEST_WORLD_Z));

// Run 2 seconds of simulation (120 frames)
for (let frame=0; frame<120; frame++) {
    const rX = Math.floor(getRiverCenter(injectZ));
    for(let x=rX - 4; x<=rX + 4; x++) {
        const idx = (x + half) + 10 * size;
        engineA.W[idx] += 5.0; 
    }
    for(let j=0; j<8; j++) {
        engineA.simulate();
    }
}

// Print water depths across the dam cross-section
console.log("\\nWater depths at Dam Z (", TEST_WORLD_Z, "):");
const zIdx = half; // Since TEST_WORLD_Z == originZ, it's exactly at index z = size/2
for (let x = -40; x <= 40; x += 5) {
    const idx = (x + half) + zIdx * size;
    const w = engineA.W[idx];
    const diff = engineA.T[idx] - engineA.T_base[idx];
    console.log(\`x=\${x} | Terrain Diff: \${diff.toFixed(1)} | Water: \${w.toFixed(2)}\`);
}
`;

const result = ts.transpileModule(merged, { compilerOptions: { module: ts.ModuleKind.CommonJS }});
fs.writeFileSync('test_engine_compiled.js', result.outputText);
