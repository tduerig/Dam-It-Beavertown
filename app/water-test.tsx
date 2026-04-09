import { useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import { WaterEngine, WATER_SIZE } from '../src/utils/WaterEngine';
import { PlacedBlock, DraggableLog } from '../src/store';
import { getBaseTerrainHeight, getRiverCenter, getTerrainHeight, clearGeneratedTerrain } from '../src/utils/terrain';
import { updateTerrainConfig, TerrainConfig, globalTerrainConfig } from '../src/utils/terrainConfig';
import { deserializeOffsets, applyTerrainMod } from '../src/utils/terrainOffsets';
type TestTreeType = 'lily' | 'cattail' | 'sapling' | 'small' | 'big';
interface TestTree {
  x: number;
  z: number;
  type: TestTreeType;
}

interface TestScenario {
  id: string;
  name: string;
  color: string;
  configure: (damCenter: number, test_z: number) => { 
    blocks: PlacedBlock[]; 
    logs: DraggableLog[]; 
    offsets: Record<string, number>; 
  };
  terrainConfig: Partial<TerrainConfig>;
}

const TEST_WORLD_Z = 20;

const configs = {
  baseline: { riverDepth: 3, twistAmplitude: 15, twistFrequency: 0.01 },
  straight: { riverDepth: 3, twistAmplitude: 0, twistFrequency: 0 },
  highTwist: { riverDepth: 3, twistAmplitude: 30, twistFrequency: 0.03 },
  shallow: { riverDepth: 1.5, twistAmplitude: 15, twistFrequency: 0.01 },
  deep: { riverDepth: 6, twistAmplitude: 15, twistFrequency: 0.01 }
};

const fullDamConfigure = (damCenter: number, tz: number) => {
  const offsets: Record<string, number> = {};
  
  // Predict absolute minimum topological height based off the direct riverbed so we aren't tricked by Perlin valleys
  // +15 height fully mathematically guarantees the huge S-curve bends in Twisty Dams don't breach local ridges!
  const riverBedH = getTerrainHeight(damCenter, tz);
  const damTopGlobal = riverBedH + 15.0; 

  // Create a thick terrain wall curving to perfectly intersect the river flow
  for(let z = tz - 2; z <= tz + 4; z += 2) {
      const localCenter = Math.floor(getRiverCenter(z));
      // Span an absolutely massive 130-unit barrier to mathematically intersect the Humboldt Mountains natively!
      for(let x = localCenter - 65; x <= localCenter + 65; x += 2) { 
          const currentH = getTerrainHeight(x, z);
          // Scale dam to effectively seal the entire local topology!
          if (damTopGlobal > currentH) {
              offsets[`${x},${z}`] = damTopGlobal - currentH;
          }
      }
  }

  // Drop dynamic physics logs
  const logs: DraggableLog[] = [];
  logs.push({ id: 'log1', position: [damCenter, damTopGlobal - 1, tz], rotation: [0, Math.PI / 2, 0], isDragged: false });
  logs.push({ id: 'log2', position: [damCenter - 3, damTopGlobal - 1, tz + 2], rotation: [0, Math.PI / 2 + 0.2, 0], isDragged: false });
  logs.push({ id: 'log3', position: [damCenter + 4, damTopGlobal - 1, tz - 1], rotation: [0, Math.PI / 2 - 0.2, 0], isDragged: false });

  return { blocks: [], logs, offsets };
};

const baselineConfigure = () => ({ blocks: [], logs: [], offsets: {} });

const SCENARIOS: TestScenario[] = [
  { id: '1', name: 'Baseline River', color: '#94a3b8', terrainConfig: configs.baseline, configure: baselineConfigure },
  { id: '2', name: 'Baseline Dam', color: '#fbbf24', terrainConfig: configs.baseline, configure: fullDamConfigure },
  
  { id: '3', name: 'Straight River', color: '#94a3b8', terrainConfig: configs.straight, configure: baselineConfigure },
  { id: '4', name: 'Straight Dam', color: '#fbbf24', terrainConfig: configs.straight, configure: fullDamConfigure },

  { id: '5', name: 'Twisty River', color: '#94a3b8', terrainConfig: configs.highTwist, configure: baselineConfigure },
  { id: '6', name: 'Twisty Dam', color: '#fbbf24', terrainConfig: configs.highTwist, configure: fullDamConfigure },

  { id: '7', name: 'Shallow River', color: '#94a3b8', terrainConfig: configs.shallow, configure: baselineConfigure },
  { id: '8', name: 'Shallow Dam', color: '#fbbf24', terrainConfig: configs.shallow, configure: fullDamConfigure },

  { id: '9', name: 'Deep River', color: '#94a3b8', terrainConfig: configs.deep, configure: baselineConfigure },
  { id: '10', name: 'Deep Dam', color: '#fbbf24', terrainConfig: configs.deep, configure: fullDamConfigure }
];

export default function WaterTestPlayground() {
  const size = WATER_SIZE;
  const canvasRefs = useRef<{ [id: string]: HTMLCanvasElement | null }>({});
  const [stats, setStats] = useState<Record<string, { lilies: number, cattails: number, trees: number }>>({});

  useEffect(() => {
    const half = size / 2;
    const damCenter = Math.floor(getRiverCenter(TEST_WORLD_Z));
    
    // Initialize engines and ecosystems dynamically
    const engines: Record<string, WaterEngine> = {};
    const ecosystems: Record<string, TestTree[]> = {};
    
    SCENARIOS.forEach(sc => {
        updateTerrainConfig(sc.terrainConfig);
        
        // Wipe global offsets so tests are isolated
        deserializeOffsets({});
        clearGeneratedTerrain();
        
        // Re-get dam center for this specific river configuration
        const localDamCenter = Math.floor(getRiverCenter(TEST_WORLD_Z));
        const conf = sc.configure(localDamCenter, TEST_WORLD_Z);
        
        // Apply offsets geometry mimicking actual player interaction
        Object.entries(conf.offsets).forEach(([k, v]) => {
            const [x, z] = k.split(',').map(Number);
            applyTerrainMod(x, z, v, 2.5);
        });
        
        const eng = new WaterEngine();
        eng.size = size; eng.originX = 0; eng.originZ = TEST_WORLD_Z;
        eng.W = new Float32Array(size * size);
        eng.T = new Float32Array(size * size);
        eng.T_base = new Float32Array(size * size);
        eng.initBase(); // This safely reads the newly minted player-like terrain offsets
        
        eng.updateTerrain(conf.blocks, conf.logs);
        engines[sc.id] = eng;
        ecosystems[sc.id] = [];
    });

    // 20 real-world minutes = 1200 seconds. Physics runs at 60 ticks/s natively.
    // Total steps needed: 72,000. We run 40 steps per 16ms render loop (approx ~30 sec real run-time)
    const TARGET_STEPS = 72000;
    const STEPS_PER_REC = 3600; // 1 virtual minute
    const STEPS_PER_ECOLOGY = 18000; // 5 virtual minutes (dawn)
    
    let engineStepArray: Record<string, { coverage: number, lilies: number, cattails: number }[]> = {};
    SCENARIOS.forEach(sc => engineStepArray[sc.id] = []);
    
    let globalStep = 0;
    setStats({ status: 'SIMULATING_0_MINS' } as any);

    const interval = setInterval(() => {
      // If we finished the 20 minute simulation:
      if (globalStep >= TARGET_STEPS) {
        console.log('Simulation complete - dispatching to save server');
        setSimStatus('SIMULATION_COMPLETE_20_MINS');
        
        // Compile physical proof screenshot
        const megaCanvas = document.createElement('canvas');
        megaCanvas.width = 180 * 5;
        megaCanvas.height = 180 * 2;
        const ctx = megaCanvas.getContext('2d');
        if (ctx) {
            ctx.fillStyle = '#0f172a';
            ctx.fillRect(0, 0, megaCanvas.width, megaCanvas.height);
            SCENARIOS.forEach((sc, i) => {
                const sourceCvs = canvasRefs.current[sc.id];
                if (sourceCvs) {
                    const px = (i % 5) * 180;
                    const py = Math.floor(i / 5) * 180;
                    ctx.drawImage(sourceCvs, px, py, 180, 180);
                }
            });
        }
        
        // After simulating all, serialize output
        const finalObj = {
            status: 'SIMULATION_COMPLETE_20_MINS',
            timeseries: engineStepArray,
            image: megaCanvas.toDataURL('image/png')
        };
        setStats(finalObj as any);
        fetch('http://localhost:9999', { method: 'POST', body: JSON.stringify(finalObj) }).catch(() => {});
          return;
      }
      
      const injectZ = TEST_WORLD_Z - half + 10;
      
      for(let iter=0; iter<40; iter++) {
          if (globalStep >= TARGET_STEPS) break;
          globalStep++;

          SCENARIOS.forEach(sc => {
              updateTerrainConfig(sc.terrainConfig);
              const rX = Math.floor(getRiverCenter(injectZ));
              const eng = engines[sc.id];

              eng.simulate();
              
              // Record timeseries every Virtual Minute
              if (globalStep % STEPS_PER_REC === 0) {
                  const trees = ecosystems[sc.id];
                  let waterCells = 0;
                  for (let i = 0; i < size * size; i++) if (eng.W[i] > 0.05) waterCells++;
                  engineStepArray[sc.id].push({
                      coverage: Math.round((waterCells / (size * size)) * 100),
                      lilies: trees.filter(t => t.type === 'lily').length,
                      cattails: trees.filter(t => t.type === 'cattail').length
                  });
              }
              
              // Propagate Ecology every Virtual 5 Minutes (Dawn) + INITIAL BURST AT T=0
              if (globalStep % STEPS_PER_ECOLOGY === 0 || globalStep === 1) {
                  propagateTestForest(eng, ecosystems[sc.id]);
              }
          });
      }

      SCENARIOS.forEach(sc => {
          // Draw Canvas for visual observation
          const cvs = canvasRefs.current[sc.id];
          const eng = engines[sc.id];
          if (cvs && globalStep % 400 === 0) { // Throttle drawings
              const ctx = cvs.getContext('2d');
              if (ctx) drawEngine(ctx, eng, ecosystems[sc.id], size);
          }
      });
      
      if (globalStep % 400 === 0) {
          setStats({ status: `SIMULATING_${Math.floor(globalStep / 3600)}_MINS` } as any);
      }
      
    }, 16);
    return () => clearInterval(interval);
  }, []);

  // Isolate ecosystem rules
  function propagateTestForest(engine: WaterEngine, trees: TestTree[]) {
      // Cast 800 random rays mapping to reality
      for(let i=0; i<800; i++) {
          const x = Math.floor(Math.random() * engine.size);
          const z = Math.floor(Math.random() * engine.size);
          const idx = x + z * engine.size;
          
          const depth = engine.W[idx];
          const height = engine.T_base[idx];
          const speed = Math.sqrt(engine.VX[idx]**2 + engine.VZ[idx]**2);
          
          // Food rules: relaxed boundary for calm water to allow natural baseline patches
          const isCalmWater = speed < 1.5;
          const surfaceAlt = height + depth;
          const greenZoneFalloff = Math.max(0, 1 - Math.abs(surfaceAlt - 5) / 7);

          if (isCalmWater && depth >= 0.2 && Math.random() < 0.15 * greenZoneFalloff) {
              trees.push({ x, z, type: 'lily' });
          } else if (isCalmWater && depth > 0.01 && depth < 0.2 && Math.random() < 0.45 * greenZoneFalloff) {
              // Shallow waters -> Cattails
              trees.push({ x, z, type: 'cattail' });
          } else if (height > -1 && height < 12 && depth <= 0.01 && Math.random() < 0.10) {
              // Light proxy: don't spawn if another tree is within 4 tiles
              const hasLight = !trees.some(t => ['sapling', 'small', 'big'].includes(t.type) && Math.sqrt((t.x - x)**2 + (t.z - z)**2) < 4);
              if (hasLight) {
                  trees.push({ x, z, type: 'sapling' });
              }
          }
      }
      
      // Growth simulation
      trees.forEach(tree => {
          if (tree.type === 'sapling' && Math.random() < 0.6) tree.type = 'small';
          else if (tree.type === 'small' && Math.random() < 0.05) tree.type = 'big';
      });
  }

  function drawEngine(ctx: CanvasRenderingContext2D, engine: WaterEngine, trees: TestTree[], size: number) {
      const imgData = ctx.createImageData(size, size);
      for(let i=0; i<size*size; i++) {
          const h = engine.T[i];
          const hBase = engine.T_base[i];
          const w = engine.W[i]; 
          
          let r = 0, g = 0, b = 0;
          const diff = h - hBase;
          
          if (diff > 0.5) {
              if (diff > 5.0) { r = 240; g = 60; b = 60; }
              else if (diff > 3.0) { r = 240; g = 140; b = 20; }
              else { r = 180; g = 80; b = 200; }
          } else {
              if (hBase < -3.0) { r = 60; g = 80; b = 40; }
              else if (hBase < 0.0) { r = 80; g = 100; b = 40; }
              else if (hBase < 2.0) { r = 100; g = 120; b = 50; }
              else if (hBase < 5.0) { r = 120; g = 110; b = 80; }
              else if (hBase < 8.0) { r = 140; g = 130; b = 100; }
              else { r = 220; g = 220; b = 230; }
          }
           
          if (i > size) {
             const df = h - engine.T[i - size];
             if (df > 0.4) { r += 40; g += 40; b += 40; }
             else if (df < -0.4) { r -= 40; g -= 40; b -= 40; }
          }
           
          if (w > 0.05) {
              const depthNorm = Math.min(1.0, w / 6.0);
              const alphaMask = (diff > 0.5) ? Math.min(0.5, depthNorm) : depthNorm;
              r = r * (1 - alphaMask) + 10 * alphaMask;
              g = g * (1 - alphaMask) + 60 * alphaMask;
              b = b * (1 - alphaMask) + 220 * alphaMask;
          }
          const idx = i * 4;
          imgData.data[idx] = Math.max(0, Math.min(255, r)); 
          imgData.data[idx+1] = Math.max(0, Math.min(255, g)); 
          imgData.data[idx+2] = Math.max(0, Math.min(255, b)); 
          imgData.data[idx+3] = 255;
      }
      
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = size; tempCanvas.height = size;
      const tCtx = tempCanvas.getContext('2d');
      if (tCtx) {
          tCtx.putImageData(imgData, 0, 0);
          
          // Draw plants over image data!
          trees.forEach(t => {
              if (t.type === 'lily') {
                  tCtx.fillStyle = '#86efac'; // light green
                  tCtx.fillRect(t.x, t.z, 2, 2); // 2x2 for visibility
              } else if (t.type === 'cattail') {
                  tCtx.fillStyle = '#facc15'; // yellow
                  tCtx.fillRect(t.x, t.z, 1, 2);
              } else if (t.type === 'big') {
                  tCtx.fillStyle = '#166534'; // dark green
                  tCtx.fillRect(t.x-1, t.z-1, 3, 3);
              } else if (t.type === 'small') {
                  tCtx.fillStyle = '#15803d'; // med green
                  tCtx.fillRect(t.x, t.z, 2, 2);
              }
          });
          
          ctx.imageSmoothingEnabled = false;
          ctx.clearRect(0,0, size, size);
          ctx.drawImage(tempCanvas, 0, 0, size, size);
      }
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#0f172a', padding: 20 }}>
      <Text style={{ color: 'white', fontSize: 24, marginBottom: 20, fontWeight: 'bold' }}>beaver-sim world-tests</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20 }}>
        {SCENARIOS.map(sc => (
            <View key={sc.id} style={{ alignItems: 'center', width: 200 }}>
              <Text style={{ color: sc.color, marginBottom: 10, fontWeight: 'bold' }}>{sc.id}: {sc.name}</Text>
              {/* @ts-ignore */}
              <canvas ref={el => canvasRefs.current[sc.id] = el} width={size} height={size} style={{ width: 180, height: 180, border: '2px solid #334155', borderRadius: 8, imageRendering: 'pixelated' }} />
            </View>
        ))}
      </View>
      {/* Hide timeseries JSON so agent can scrape it */}
      <pre id="sim-stats" style={{ display: 'none' }}>{JSON.stringify(stats)}</pre>
      <Text id="sim-status" style={{ color: '#fed7aa', marginTop: 20 }}>{stats.status as unknown as string}</Text>
    </View>
  );
}
