import fs from 'fs';
import ts from 'typescript';

const srcCode = fs.readFileSync('./app/water-test.tsx', 'utf8');
const engineSrc = fs.readFileSync('./src/utils/WaterEngine.ts', 'utf8');
const trSrc = fs.readFileSync('./src/utils/terrain.ts', 'utf8');

const merged = `
${trSrc.replace(/export /g, '')}
${engineSrc.replace(/export /g, '').replace(/import .*;/g, '')}
const TEST_WORLD_Z = -100;
const WATER_SIZE = 160;
const size = 160;
const half = 80;

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
for(let x=-20; x<=20; x++) { offsetsA[\`\${x},\${TEST_WORLD_Z}\`] = 6; offsetsA[\`\${x},\${TEST_WORLD_Z+1}\`] = 6; } 
engineA.updateTerrain([], [], offsetsA);

let coloredPixels = 0;
for(let i=0; i<size*size; i++) {
    const h = engineA.T[i];
    const hBase = engineA.T_base[i];
    const diff = h - hBase;
    
    if (diff > 0.5) coloredPixels++;
}
console.log("Colored pixels in Dam A:", coloredPixels);
`;

const result = ts.transpileModule(merged, { compilerOptions: { module: ts.ModuleKind.CommonJS }});
fs.writeFileSync('test_colors_compiled.js', result.outputText);
