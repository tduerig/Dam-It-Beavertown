import React, { useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import { WaterEngine, WATER_SIZE } from '../src/utils/WaterEngine';
import { clearGeneratedTerrain, getTerrainHeight, getRiverCenter } from '../src/utils/terrain';
import { applyTerrainMod, deserializeOffsets } from '../src/utils/terrainOffsets';
import { updateTerrainConfig } from '../src/utils/terrainConfig';
import { useGameStore } from '../src/store';
import { floraCache } from '../src/utils/floraCache';
import { npcActions } from '../src/utils/npcActions';
import { propagateForest } from '../src/utils/ecology';
import * as THREE from 'three';

const TARGET_STEPS = 216000; // 60 mins * 60 FPS = 216000 ticks

import { globalBeaverAI } from '../src/utils/BeaverAI';
export default function NpcSim() {
  const [status, setStatus] = useState('INITIALIZING');
  
  const canvasBeaver = useRef<HTMLCanvasElement | null>(null);
  const canvasControl = useRef<HTMLCanvasElement | null>(null);
  
  // Create an isolated engine
  const engBeaverRef = useRef<WaterEngine | null>(null);
  const engControlRef = useRef<WaterEngine | null>(null);

  // We explicitly run the BeaverBrain code mathematically un-hooked
  const aiStateRef = useRef<string>('OBSERVING');

  const timeseriesBeaver = useRef<{ coverage: number, lilies: number, cattails: number, trees: number }[]>([]);
  const timeseriesControl = useRef<{ coverage: number, lilies: number, cattails: number, trees: number }[]>([]);

  useEffect(() => {
    // 1. Reset Environment Completely
    useGameStore.setState({
         autopilot: true, 
         aiState: 'OBSERVING', 
         aiTarget: null, 
         playerPosition: [0, 0, 0],
         inventory: { wood: 0, stick: 0, mud: 0 },
         placedBlocks: [],
         draggableLogs: [],
         stats: { treesDowned: 0, sticksPlaced: 0, mudPatted: 0, massiveTreesFelled: 0, mudDug: 0, maxWaterCoverage: 0, snacksEaten: 0 }
    });
    
    // Simulation now natively mirrors main game without flattening mechanics

    floraCache.clear();
    clearGeneratedTerrain();
    deserializeOffsets({});

    const engA = new WaterEngine();
    engA.size = WATER_SIZE; engA.originX = 0; engA.originZ = 0;
    engA.W = new Float32Array(WATER_SIZE * WATER_SIZE);
    engA.T = new Float32Array(WATER_SIZE * WATER_SIZE);
    engA.T_base = new Float32Array(WATER_SIZE * WATER_SIZE);
    engA.initBase();
    engBeaverRef.current = engA;

    const engB = new WaterEngine();
    engB.size = WATER_SIZE; engB.originX = 0; engB.originZ = 2000;
    engB.W = new Float32Array(WATER_SIZE * WATER_SIZE);
    engB.T = new Float32Array(WATER_SIZE * WATER_SIZE);
    engB.T_base = new Float32Array(WATER_SIZE * WATER_SIZE);
    engB.initBase();
    engControlRef.current = engB;

    let nextFloraId = 0;
    const spawnInitialFlora = (zOffset: number) => {
        // Spawn 200 flora items per world for a rich starting ecosystem
        for(let i=0; i<200; i++) {
            const x = (Math.random() - 0.5) * 120;
            const z = zOffset + (Math.random() - 0.5) * 120;
            const h = getTerrainHeight(x, z);
            const rand = Math.random();
            let type: 'big'|'small'|'sapling'|'lily'|'cattail' = 'sapling';
            if (h > 0) {
                // Heavily favor big oaks — they're the primary resource
                if (rand < 0.35) type = 'big';
                else if (rand < 0.65) type = 'small';
                // else stays 'sapling'
            } else {
                if (rand < 0.5) type = 'lily';
                else type = 'cattail';
            }
            const cx = Math.floor(x / 40);
            const cz = Math.floor(z / 40);
            floraCache.add(`${cx},${cz}`, { id: `flora_${nextFloraId++}`, position: [x, h, z], type } as any);
        }
    };
    
    spawnInitialFlora(0);
    spawnInitialFlora(2000);

    let globalStep = 0;
    
    const interval = setInterval(() => {
        if (globalStep >= TARGET_STEPS) {
            clearInterval(interval);
            setStatus('SIMULATION_COMPLETE');
            
            const payload = {
                status: 'NPC_SIMULATION_COMPLETE_30_MINS',
                timeseries: { 
                    'npc_beaver': timeseriesBeaver.current,
                    'control': timeseriesControl.current
                },
                stats: useGameStore.getState().stats,
                aiBehaviorStats: globalBeaverAI.stateTimeAccumulator
            };
            fetch('http://localhost:9999', { method: 'POST', body: JSON.stringify(payload), headers: {'Content-Type': 'application/json'} }).catch(() => {});
            return;
        }

        const TICK_SIZE = 15; // Run 15 physicsframes per UI frame to massively speed it!
        for (let t = 0; t < TICK_SIZE; t++) {
            const gameRoot = useGameStore.getState();
            
            // Allow WaterEngine to observe modifications
            engA.updateTerrain(gameRoot.placedBlocks, gameRoot.draggableLogs);
            engB.updateTerrain([], []); // Control river is pristine baseline!

            engA.simulate();
            engB.simulate();
            
            const now = globalStep * 16.666; // Unified 60fps simulated clock
            
            // --- AI KINEMATICS --- (Player hook substitute)
            if (gameRoot.aiTarget) {
                const px = gameRoot.playerPosition[0];
                const pz = gameRoot.playerPosition[2];
                const dx = gameRoot.aiTarget[0] - px;
                const dz = gameRoot.aiTarget[2] - pz;
                const dist = Math.sqrt(dx*dx + dz*dz);
                if (dist > 0.5) {
                    const speed = 4.5 * 0.016; // 4.5 m/s beaver
                    gameRoot.playerPosition[0] = px + (dx/dist) * Math.min(speed, dist);
                    gameRoot.playerPosition[1] = getTerrainHeight(px, pz);
                    gameRoot.playerPosition[2] = pz + (dz/dist) * Math.min(speed, dist);
                    gameRoot.playerRotation = Math.atan2(dx, dz);
                }
            } else {
                gameRoot.playerPosition[1] = getTerrainHeight(gameRoot.playerPosition[0], gameRoot.playerPosition[2]);
            }
            
            // Sync dragged logs with player!
            const dragged = gameRoot.draggableLogs.find(l => l.isDragged);
            if (dragged) {
                const rx = gameRoot.playerPosition[0] + Math.sin(gameRoot.playerRotation) * 2;
                const rz = gameRoot.playerPosition[2] + Math.cos(gameRoot.playerRotation) * 2;
                dragged.position = [rx, getTerrainHeight(rx, rz) + 1.0, rz];
                dragged.rotation = [0.01, gameRoot.playerRotation + Math.PI / 2, 0];
            }
            
            // Periodically regenerate food so we don't stall!
            // triggerEcologyTick() only spawns flora near playerPosition (z~0),
            // so we also manually spawn flora in the control world (z=2000)
            if (globalStep % 18000 === 0) {
                // Ecology for Beaver world (near player) - uses the sandbox's actual water simulation!
                propagateForest(engA, gameRoot.playerPosition);
                
                // Ecology for Control world (z=2000) - now uses the exact same parameterized ecosystem rules!
                propagateForest(engB, [0, 0, 2000]);
            }
            
            // --- AI BRAIN TICK --- (Using exactly the 1:1 AI from the game)
            globalBeaverAI.tick(now, engA);

            globalStep++;
            if (globalStep % 3600 === 0) { // Record Telemetry every virtual minute
                // Track Control World (z=2000)
                let cV = 0, cL = 0, cC = 0, cT = 0;
                for (let i = 0; i < engB.size * engB.size; i++) cV += engB.W[i];
                for (const chunk of floraCache.getAllChunks()) {
                    for (const item of chunk) {
                        if (item.position[2] > 1000) { 
                            if (item.type === 'lily') cL++;
                            else if (item.type === 'cattail') cC++;
                            else if (['big', 'small', 'sapling'].includes(item.type)) cT++;
                        }
                    }
                }
                timeseriesControl.current.push({ coverage: Math.round(cV), lilies: cL, cattails: cC, trees: cT });

                // Track Beaver World (z=0)
                let bV = 0, bL = 0, bC = 0, bT = 0;
                for (let i = 0; i < engA.size * engA.size; i++) bV += engA.W[i];
                for (const chunk of floraCache.getAllChunks()) {
                    for (const item of chunk) {
                        if (item.position[2] < 1000) {
                            if (item.type === 'lily') bL++;
                            else if (item.type === 'cattail') bC++;
                            else if (['big', 'small', 'sapling'].includes(item.type)) bT++;
                        }
                    }
                }
                timeseriesBeaver.current.push({ coverage: Math.round(bV), lilies: bL, cattails: bC, trees: bT });
            }

        } // end of TICK loop

        // Helper render func for dual canvases
        const drawEngine = (cvs: HTMLCanvasElement | null, eng: WaterEngine, originZ: number, drawActors: boolean) => {
            if (!cvs || !eng) return;
            const ctx = cvs.getContext('2d');
            if (!ctx) return;

            const CAM_VIEW = 160;
            const imgData = ctx.createImageData(CAM_VIEW, CAM_VIEW);
            const viewX = 0;
            const viewZ = 0;

            for (let px = 0; px < CAM_VIEW; px++) {
                for (let pz = 0; pz < CAM_VIEW; pz++) {
                    const gx = viewX + px;
                    const gz = viewZ + pz;
                    const i = gz * WATER_SIZE + gx;
                    
                    const pixelIdx = (pz * CAM_VIEW + px) * 4;
                    
                    const w = eng.W ? eng.W[i] : 0;
                    const h = eng.T ? eng.T[i] : 0;
                    const tBase = eng.T_base ? eng.T_base[i] : 0;
                    
                    let r = 0, g = 0, b = 0;
                    if (h <= -0.5) { r = 160; g = 130; b = 70; } 
                    else if (h < 0.5) { r = 120; g = 150; b = 60; } 
                    else { r = 60; g = Math.min(255, 120 + h * 10); b = 40; } 
                    
                    if (w > 0.05) { 
                        r = 50 - w*4; g = 140 - w*2; b = 220 + w*5; 
                    }
                    if (h > tBase + 0.1) {
                         r = 100; g = 50; b = 20; 
                    }
                    
                    imgData.data[pixelIdx] = Math.min(255, Math.max(0, r));
                    imgData.data[pixelIdx + 1] = Math.min(255, Math.max(0, g));
                    imgData.data[pixelIdx + 2] = Math.min(255, Math.max(0, b));
                    imgData.data[pixelIdx + 3] = 255;
                }
            }
            ctx.putImageData(imgData, 0, 0);

            // Draw Flora associated with this engine's space
            for (const chunk of floraCache.getAllChunks()) {
                for (const item of chunk) {
                    if (originZ === 0 && item.position[2] > 1000) continue; // Skip control flora
                    if (originZ > 1000 && item.position[2] < 1000) continue; // Skip beaver flora

                    const px = Math.floor(item.position[0] + WATER_SIZE/2) - viewX;
                    const pz = Math.floor((item.position[2] - originZ) + WATER_SIZE/2) - viewZ;
                    if (px >= 0 && px < CAM_VIEW && pz >= 0 && pz < CAM_VIEW) {
                        if (item.type === 'big') ctx.fillStyle = '#14532d'; 
                        else if (item.type === 'small') ctx.fillStyle = '#22c55e';
                        else if (item.type === 'sapling') ctx.fillStyle = '#86efac';
                        else if (item.type === 'lily') ctx.fillStyle = '#67e8f9';
                        else if (item.type === 'cattail') ctx.fillStyle = '#fde047';
                        
                        ctx.beginPath();
                        ctx.arc(px, pz, item.type === 'big' ? 1.5 : 1, 0, Math.PI * 2);
                        ctx.fill();
                    }
                }
            }
            
            if (drawActors) {
                const grp = useGameStore.getState();
                for (const log of grp.draggableLogs) {
                    if (log.isMudded) continue;
                    const lpx = Math.floor(log.position[0] + WATER_SIZE/2) - viewX;
                    const lpz = Math.floor(log.position[2] + WATER_SIZE/2) - viewZ;
                    if (lpx >= 0 && lpx < CAM_VIEW && lpz >= 0 && lpz < CAM_VIEW) {
                        ctx.fillStyle = log.isDragged ? '#fb923c' : '#78350f'; 
                        ctx.fillRect(lpx - 1.5, lpz - 0.5, 3, 1.5);
                    }
                }
                const otterX = Math.floor(grp.playerPosition[0] + WATER_SIZE/2) - viewX;
                const otterZ = Math.floor(grp.playerPosition[2] + WATER_SIZE/2) - viewZ;
                ctx.fillStyle = '#f97316';
                ctx.beginPath();
                ctx.arc(otterX, otterZ, 2.5, 0, Math.PI * 2);
                ctx.fill();
            }
        };

        drawEngine(canvasBeaver.current, engA, 0, true);
        drawEngine(canvasControl.current, engB, 2000, false);
        
        setStatus(`SIMULATING_MIN_${Math.floor(globalStep / 3600)}`);

    }, 16);

    return () => clearInterval(interval);
  }, []);
  
  const sysStatus = status;
  const gameStats = useGameStore(s => s.stats);
  const aiState = useGameStore(s => s.aiState);

  return (
    <View style={{ flex: 1, backgroundColor: '#0f172a', padding: 20 }}>
      <Text style={{ color: '#fff', fontSize: 24, marginBottom: 10 }}>NPC Sandbox: World Sim (Dual Engine)</Text>
      
      <View style={{ flexDirection: 'row', gap: 20 }}>
          <View>
              <Text style={{ color: '#94a3b8', marginBottom: 10 }}>AI World (Otter Ecosystem)</Text>
              <canvas ref={canvasBeaver} width={160} height={160} 
                      style={{ width: 400, height: 400, border: '2px solid #10b981', borderRadius: 8, imageRendering: 'pixelated' }} />
          </View>
          
          <View>
              <Text style={{ color: '#94a3b8', marginBottom: 10 }}>Control World (Baseline)</Text>
              <canvas ref={canvasControl} width={160} height={160} 
                      style={{ width: 400, height: 400, border: '2px solid #ef4444', borderRadius: 8, imageRendering: 'pixelated' }} />
          </View>

          <View style={{ flex: 1, backgroundColor: '#1e293b', padding: 20, borderRadius: 8 }}>
              <Text style={{ color: '#f8fafc', fontSize: 16, marginBottom: 15 }}>Simulation Telemetry</Text>
              
              <Text style={{ color: '#6ee7b7', fontFamily: 'monospace', marginBottom: 5 }}>
                 Status: {sysStatus}
              </Text>
              <Text style={{ color: '#c084fc', fontFamily: 'monospace', marginBottom: 5 }}>
                 Time: {Number(sysStatus.replace('SIMULATING_MIN_', '')) || 0} / 60 Mins (Simulated)
              </Text>
              <Text style={{ color: '#fcd34d', fontFamily: 'monospace', marginBottom: 5 }}>
                 Temporal Speed-Up: 14.4x (Fast-Forward Mode)
              </Text>

              <Text style={{ color: '#f8fafc', fontSize: 16, marginTop: 15, marginBottom: 8 }}>AI Activity Map</Text>
              <Text style={{ color: '#38bdf8', fontFamily: 'monospace' }}>
                 NPC Task: {aiState}
              </Text>
              <Text style={{ color: '#a3e635', fontFamily: 'monospace', marginTop: 10 }}>
                 Trees Felled: {gameStats.treesDowned}
              </Text>
              <Text style={{ color: '#fbbf24', fontFamily: 'monospace', marginTop: 5 }}>
                 Mud Tracks Placed: {gameStats.mudPatted}
              </Text>
              <Text style={{ color: '#818cf8', fontFamily: 'monospace', marginTop: 5 }}>
                 Snacks Eaten: {gameStats.snacksEaten}
              </Text>
              
              <Text style={{ color: '#f8fafc', fontSize: 16, marginTop: 15, marginBottom: 8 }}>Ecology Simulation</Text>
              <Text style={{ color: '#0ea5e9', fontFamily: 'monospace' }}>
                 Beaver Water Volume: {timeseriesBeaver.current.length > 0 ? timeseriesBeaver.current[timeseriesBeaver.current.length - 1].coverage : 0} m³
              </Text>
              <Text style={{ color: '#94a3b8', fontFamily: 'monospace', marginTop: 5 }}>
                 Control Water Volume: {timeseriesControl.current.length > 0 ? timeseriesControl.current[timeseriesControl.current.length - 1].coverage : 0} m³
              </Text>
              <Text style={{ color: '#86efac', fontFamily: 'monospace', marginTop: 10 }}>
                 Flora Map: Lilies (Beaver: {timeseriesBeaver.current.length > 0 ? timeseriesBeaver.current[timeseriesBeaver.current.length - 1].lilies : 0} | Control: {timeseriesControl.current.length > 0 ? timeseriesControl.current[timeseriesControl.current.length - 1].lilies : 0})
              </Text>
              <Text style={{ color: '#fde047', fontFamily: 'monospace', marginTop: 5 }}>
                 Flora Map: Cattails (Beaver: {timeseriesBeaver.current.length > 0 ? timeseriesBeaver.current[timeseriesBeaver.current.length - 1].cattails : 0} | Control: {timeseriesControl.current.length > 0 ? timeseriesControl.current[timeseriesControl.current.length - 1].cattails : 0})
              </Text>
              <Text style={{ color: '#34d399', fontFamily: 'monospace', marginTop: 5 }}>
                 Flora Map: Trees (Beaver: {timeseriesBeaver.current.length > 0 ? timeseriesBeaver.current[timeseriesBeaver.current.length - 1].trees : 0} | Control: {timeseriesControl.current.length > 0 ? timeseriesControl.current[timeseriesControl.current.length - 1].trees : 0})
              </Text>
          </View>
      </View>
    </View>
  );
}
