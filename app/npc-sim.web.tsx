import React, { useEffect, useRef, useState } from 'react';
import { View, Text } from 'react-native';
import { WaterEngine, WATER_SIZE } from '../src/utils/WaterEngine';
import { clearGeneratedTerrain, getTerrainHeight, getRiverCenter } from '../src/utils/terrain';
import { applyTerrainMod, deserializeOffsets } from '../src/utils/terrainOffsets';
import { updateTerrainConfig } from '../src/utils/terrainConfig';
import { useGameStore } from '../src/store';
import { floraCache } from '../src/utils/floraCache';
import { npcActions } from '../src/utils/npcActions';
import * as THREE from 'three';

const TARGET_STEPS = 72000; // 20 mins * 60 FPS = 72000 ticks

export default function NpcSim() {
  const [status, setStatus] = useState('INITIALIZING');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Create an isolated engine
  const engineRef = useRef<WaterEngine | null>(null);

  // We explicitly run the BeaverBrain code mathematically un-hooked
  const aiStateRef = useRef<string>('IDLE');
  const aiTargetIdRef = useRef<string | null>(null);
  const aiTargetPosRef = useRef<THREE.Vector3 | null>(null);
  const damTargetZ = useRef<number | null>(null);
  const aiLastThinkTime = useRef(0);
  const aiComboTimer = useRef(0);
  const aiStateStartTime = useRef(0);
  const aiLogWaitId = useRef<string | null>(null);
  const aiMacroStep = useRef(0);

  const timeseriesData = useRef<{ coverage: number, lilies: number, cattails: number }[]>([]);

  useEffect(() => {
    // 1. Reset Environment Completely
    useGameStore.setState({
         autopilot: true, 
         aiState: 'IDLE', 
         aiTarget: null, 
         playerPosition: [0, 0, 0],
         inventory: { wood: 0, stick: 0, mud: 0 },
         placedBlocks: [],
         draggableLogs: [],
         stats: { treesDowned: 0, sticksPlaced: 0, mudPatted: 0, massiveTreesFelled: 0 }
    });
    
    // Inject the Twisty River topology globally!
    updateTerrainConfig({ riverDepth: 3, twistAmplitude: 30, twistFrequency: 0.03 });

    floraCache.clear();
    clearGeneratedTerrain();
    deserializeOffsets({});

    const eng = new WaterEngine(0);
    engineRef.current = eng;

    // Spawn 100 random trees + flora logically
    for(let i=0; i<100; i++) {
        const x = (Math.random() - 0.5) * 120;
        const z = (Math.random() - 0.5) * 120;
        const h = getTerrainHeight(x, z);
        const rand =  Math.random();
        let type: 'big'|'small'|'sapling'|'lily'|'cattail' = 'sapling';
        if (h > 0) {
            if (rand < 0.2) type = 'big';
            else if (rand < 0.6) type = 'small';
        } else {
            if (rand < 0.5) type = 'lily';
            else type = 'cattail';
        }
        const cx = Math.floor(x / 40);
        const cz = Math.floor(z / 40);
        floraCache.add(`${cx},${cz}`, { id: `flora_${i}`, position: [x, h, z], type } as any);
    }

    let globalStep = 0;
    
    const transition = (newState: string, debugStr: string) => {
        aiStateRef.current = newState;
        aiStateStartTime.current = globalStep * 16;
        useGameStore.getState().setAITarget(null);
        useGameStore.getState().setAIState(debugStr);
    };

    const interval = setInterval(() => {
        if (globalStep >= TARGET_STEPS) {
            clearInterval(interval);
            setStatus('SIMULATION_COMPLETE');
            
            const payload = {
                status: 'NPC_SIMULATION_COMPLETE_20_MINS',
                timeseries: { 'npc_beaver': timeseriesData.current }
            };
            fetch('http://localhost:9999', { method: 'POST', body: JSON.stringify(payload) }).catch(() => {});
            return;
        }

        const TICK_SIZE = 15; // Run 15 physicsframes per UI frame to massively 10x-speed it!
        for (let t = 0; t < TICK_SIZE; t++) {
            eng.simulate(0.016, globalStep);
            
            const gameRoot = useGameStore.getState();
            const now = globalStep * 16;
            
            // --- AI KINEMATICS --- (Player hook substitute)
            if (gameRoot.aiTarget) {
                const px = gameRoot.playerPosition[0];
                const pz = gameRoot.playerPosition[2];
                const dx = gameRoot.aiTarget[0] - px;
                const dz = gameRoot.aiTarget[2] - pz;
                const dist = Math.sqrt(dx*dx + dz*dz);
                if (dist > 0.5) {
                    const speed = 4.5 * 0.016; // 4.5 m/s beaver
                    useGameStore.getState().setPlayerPosition([
                        px + (dx/dist) * Math.min(speed, dist),
                        getTerrainHeight(px, pz),
                        pz + (dz/dist) * Math.min(speed, dist)
                    ]);
                    useGameStore.getState().playerRotation = Math.atan2(dx, dz);
                }
            }
            
            // --- AI BRAIN TICK --- (BeaverBrain hook substitute)
            if (now - aiLastThinkTime.current > 40) {
                aiLastThinkTime.current = now;
                const pos = new THREE.Vector3(...gameRoot.playerPosition);

                if (damTargetZ.current === null) damTargetZ.current = pos.z + 5;
                const damZ = damTargetZ.current;
                const riverX = getRiverCenter(damZ);
                const buildCount = gameRoot.stats.treesDowned + gameRoot.stats.sticksPlaced + gameRoot.stats.mudPatted;
                
                let worstX = riverX;
                let worstScore = -1;
                for (let x = riverX - 15; x <= riverX + 15; x += 1.5) {
                    const depth = eng.getWaterDepth(x, damZ);
                    const tieBreaker = Math.sin(x * 0.5 + buildCount) * 0.1;
                    const score = (depth * 2.5) + tieBreaker;
                    if (score > worstScore) { worstScore = score; worstX = x; }
                }
                const damCenter = new THREE.Vector3(worstX, 0, damZ);

                const isDragging = gameRoot.draggableLogs.some(l => l.isDragged);
                
                if (isDragging && !['DELIVER_WATER', 'FORTIFY_DAM', 'GATHER_MUD'].includes(aiStateRef.current)) {
                    aiTargetPosRef.current = null;
                    transition('DELIVER_WATER', 'Dragging log to river!');
                }

                if (aiStateRef.current !== 'IDLE' && aiStateRef.current !== 'EXPLORE') {
                    const maxTime = aiStateRef.current === 'CHOP_TREE' ? 25000 : 15000;
                    if (now - aiStateStartTime.current > maxTime) transition('EXPLORE', 'Got bored. Exploring...');
                } else if (['EXPLORE', 'PLAY', 'EXPLORE_FOR_FOOD'].includes(aiStateRef.current)) {
                    if (now - aiStateStartTime.current > 20000) transition('IDLE', 'Finished activity.');
                } else if (aiStateRef.current === 'IDLE') {
                    aiStateStartTime.current = now;
                }

                switch (aiStateRef.current) {
                    case 'IDLE':
                        if (Math.random() < 0.25) {
                            Math.random() < 0.5 ? transition('EAT', 'Looking for food.') : transition('PLAY', 'Playing!');
                        } else {
                            const freeLog = gameRoot.draggableLogs.find(l => !l.isDragged && !l.isMudded && l.position[1] > -5); 
                            if (freeLog) {
                                aiTargetIdRef.current = freeLog.id;
                                transition('FIND_LOG', 'Found a loose log.');
                            } else if (gameRoot.inventory.sticks > 4) {
                                transition('FORTIFY_DAM', 'Got sticks, packing dam!');
                            } else if (gameRoot.inventory.mud < 4 && Math.random() < 0.4) {
                                transition('GATHER_MUD', 'Gathering mud for dam.');
                            } else {
                                transition('FIND_TREE', 'Looking for timber to chop.');
                            }
                        }
                        break;
                    
                    case 'EAT': {
                        let snack = null;
                        let minD = Infinity;
                        for (const chunk of floraCache.getClosestChunks(Math.floor(pos.x/40), Math.floor(pos.z/40), 1)) {
                            for (const item of chunk) {
                                if (['lily', 'cattail', 'sapling'].includes(item.type)) {
                                    const d = pos.distanceToSquared(new THREE.Vector3(...item.position));
                                    if (d < minD) { minD = d; snack = item; }
                                }
                            }
                        }
                        if (snack) {
                            if (minD < 9) {
                                useGameStore.getState().setAITarget(null);
                                if (now > aiComboTimer.current) {
                                    npcActions.eatSnack(snack as any, '0,0');
                                    aiComboTimer.current = now + 400;
                                    transition('IDLE', 'Yum.');
                                }
                            } else useGameStore.getState().setAITarget(snack.position);
                        } else transition('EXPLORE_FOR_FOOD', 'No food.');
                        break;
                    }
                    case 'FIND_TREE':
                    case 'CHOP_TREE': {
                        let nearest = null;
                        let minD = Infinity;
                        for (const chunk of floraCache.getClosestChunks(Math.floor(pos.x/40), Math.floor(pos.z/40), 1)) {
                            for (const item of chunk) {
                                if (['big', 'small'].includes(item.type)) {
                                    const isBig = item.type === 'big';
                                    if (eng.getSurfaceHeight(item.position[0], item.position[2]) > item.position[1] + 0.5) continue;
                                    const d = pos.distanceToSquared(new THREE.Vector3(...item.position)) - (isBig ? 100000 : 0);
                                    if (d < minD) { minD = d; nearest = item; }
                                }
                            }
                        }
                        if (nearest) {
                            const dist = pos.distanceTo(new THREE.Vector3(...nearest.position));
                            if (dist <= 4.0) {
                                useGameStore.getState().setAITarget(null);
                                if (aiStateRef.current !== 'CHOP_TREE') transition('CHOP_TREE', 'Chopping!');
                                if (now > aiComboTimer.current) {
                                    const res = npcActions.chopTree(pos, nearest as any, '0,0');
                                    aiComboTimer.current = now + 500;
                                    if (res.felled) {
                                        if (res.newLogId) { aiLogWaitId.current = res.newLogId; transition('WAIT_LOG', ''); }
                                        else { transition('FORTIFY_DAM', ''); }
                                    }
                                }
                            } else useGameStore.getState().setAITarget(nearest.position);
                        } else transition('EXPLORE', 'No timber.');
                        break;
                    }
                    case 'FIND_LOG': {
                        const log = gameRoot.draggableLogs.find(l => l.id === aiTargetIdRef.current && !l.isDragged && !l.isMudded);
                        if (!log) transition('IDLE', 'Log gone.');
                        else if (pos.distanceTo(new THREE.Vector3(...log.position)) <= 5) {
                            useGameStore.getState().setAITarget(null);
                            if (now > aiComboTimer.current) {
                                npcActions.pickupLog(log.id);
                                aiComboTimer.current = now + 150;
                                transition('DELIVER_WATER', '');
                            }
                        } else useGameStore.getState().setAITarget(log.position);
                        break;
                    }
                    case 'WAIT_LOG': {
                        if (now - aiStateStartTime.current > 1600) {
                            if (aiLogWaitId.current) npcActions.pickupLog(aiLogWaitId.current);
                            transition('DELIVER_WATER', '');
                        }
                        break;
                    }
                    case 'DELIVER_WATER': {
                        const distSq = pos.distanceToSquared(damCenter);
                        if (!isDragging) {
                            distSq > 36 ? transition('IDLE', '') : transition('FORTIFY_DAM', '');
                        } else if (distSq < 9) {
                            useGameStore.getState().setAITarget(null);
                            if (now > aiComboTimer.current) {
                                const dLog = gameRoot.draggableLogs.find(l => l.isDragged);
                                if (dLog) npcActions.dropLog(dLog.id);
                                aiComboTimer.current = now + 200;
                            }
                        } else {
                            if (Math.abs(pos.z - damCenter.z) > 15) {
                                const bx = riverX + (pos.x > riverX ? 15 : -15);
                                useGameStore.getState().setAITarget([bx, getTerrainHeight(bx, pos.z), pos.z > damCenter.z ? pos.z - 8 : pos.z + 8]);
                            } else useGameStore.getState().setAITarget([damCenter.x, 0, damCenter.z]);
                        }
                        break;
                    }
                    case 'FORTIFY_DAM': {
                        if (gameRoot.inventory.mud < 4) { transition('GATHER_MUD', ''); break; }
                        if (pos.distanceToSquared(damCenter) > 16) { useGameStore.getState().setAITarget([damCenter.x, 0, damCenter.z]); break; }
                        
                        useGameStore.getState().setAITarget(null);
                        if (aiMacroStep.current === 0 && now > aiComboTimer.current) {
                            npcActions.placeMud({x: damCenter.x, z: damCenter.z});
                            aiComboTimer.current = now + 600;
                            if (getTerrainHeight(damCenter.x, damCenter.z) > eng.getSurfaceHeight(damCenter.x, damCenter.z) - 0.1) aiMacroStep.current = 1;
                        } else if (aiMacroStep.current === 1 && now > aiComboTimer.current) {
                            npcActions.placeStick(gameRoot.playerRotation, {x: damCenter.x, z: damCenter.z});
                            aiComboTimer.current = now + 600;
                            aiMacroStep.current = 2;
                        } else if (aiMacroStep.current === 2 && now > aiComboTimer.current) {
                            npcActions.placeMud({x: damCenter.x, z: damCenter.z});
                            aiComboTimer.current = now + 600;
                            transition('IDLE', 'Built.');
                        }
                        break;
                    }
                    case 'GATHER_MUD': {
                        const bx = riverX + (pos.x > riverX ? 18 : -18);
                        if (Math.abs(pos.x - bx) > 3) useGameStore.getState().setAITarget([bx, 0, pos.z]);
                        else {
                            useGameStore.getState().setAITarget(null);
                            if (now > aiComboTimer.current) {
                                npcActions.digMud({x: pos.x + Math.sin(gameRoot.playerRotation + Math.PI)*2, z: pos.z + Math.cos(gameRoot.playerRotation+Math.PI)*2});
                                aiComboTimer.current = now + 800;
                                if (gameRoot.inventory.mud >= 5) transition('IDLE', '');
                            }
                        }
                        break;
                    }
                    case 'EXPLORE':
                    case 'EXPLORE_FOR_FOOD':
                    case 'PLAY': {
                        transition('IDLE', 'Bored.');
                    }
                }
            }
            
            globalStep++;
            if (globalStep % 3600 === 0) {
                let waterCells = 0, lilies = 0, cattails = 0;
                for (let i = 0; i < eng.size * eng.size; i++) if (eng.W[i] > 0.05) waterCells++;
                for (const chunk of floraCache.getAllChunks()) {
                    for (const item of chunk) {
                        if (item.type === 'lily') lilies++;
                        if (item.type === 'cattail') cattails++;
                    }
                }
                const cov = Math.round((waterCells / (WATER_SIZE * WATER_SIZE)) * 100);
                timeseriesData.current.push({ coverage: cov, lilies, cattails });
            }
        }

        // Render Frame
        const cvs = canvasRef.current;
        if (cvs && eng) {
            const ctx = cvs.getContext('2d');
            if (ctx) {
                const CAM_VIEW = 80; // Zoomed in 80x80
                const imgData = ctx.createImageData(CAM_VIEW, CAM_VIEW);
                
                const grp = useGameStore.getState();
                const viewX = Math.max(0, Math.min(WATER_SIZE - CAM_VIEW, Math.floor(grp.playerPosition[0] + WATER_SIZE/2 - CAM_VIEW/2)));
                const viewZ = Math.max(0, Math.min(WATER_SIZE - CAM_VIEW, Math.floor(grp.playerPosition[2] + WATER_SIZE/2 - CAM_VIEW/2)));

                for (let px = 0; px < CAM_VIEW; px++) {
                    for (let pz = 0; pz < CAM_VIEW; pz++) {
                        const gx = viewX + px;
                        const gz = viewZ + pz;
                        const i = gz * WATER_SIZE + gx;
                        
                        const pixelIdx = (pz * CAM_VIEW + px) * 4;
                        
                        const w = eng.W[i];
                        const h = eng.H[i];
                        
                        // Topological Shading
                        let r = 0, g = 0, b = 0;
                        if (h <= -0.5) { r = 160; g = 130; b = 70; } // Riverbed dirt
                        else if (h < 0.5) { r = 120; g = 150; b = 60; } // Bank Shore
                        else { r = 60; g = Math.min(255, 120 + h * 10); b = 40; } // Grass plains & hills
                        
                        // Water Override
                        if (w > 0.05) { 
                            // Blend water based on depth
                            r = 50 - w*4; g = 140 - w*2; b = 220 + w*5; 
                        }
                        
                        // Mud Mod
                        if (eng.T[i] > eng.T_base[i] + 0.1) {
                             r = 100; g = 50; b = 20; // Hardened Beaver Mud
                        }
                        
                        imgData.data[pixelIdx] = Math.min(255, Math.max(0, r));
                        imgData.data[pixelIdx + 1] = Math.min(255, Math.max(0, g));
                        imgData.data[pixelIdx + 2] = Math.min(255, Math.max(0, b));
                        imgData.data[pixelIdx + 3] = 255;
                    }
                }
                ctx.putImageData(imgData, 0, 0);

                // Draw Fluffball
                const otterX = Math.floor(grp.playerPosition[0] + WATER_SIZE/2) - viewX;
                const otterZ = Math.floor(grp.playerPosition[2] + WATER_SIZE/2) - viewZ;
                ctx.fillStyle = '#78350f';
                ctx.beginPath();
                ctx.arc(otterX, otterZ, 2, 0, Math.PI * 2);
                ctx.fill();
            }
            setStatus(`SIMULATING_MIN_${Math.floor(globalStep / 3600)}`);
        }
    }, 16);

    return () => clearInterval(interval);
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: '#0f172a', padding: 20 }}>
      <Text style={{ color: '#fff', fontSize: 24, marginBottom: 10 }}>Headless NPC A/B Sandbox Environment</Text>
      <Text style={{ color: '#6ee7b7', fontSize: 16, marginBottom: 20 }}>Status: {status}</Text>
      
      <View style={{ flexDirection: 'row', gap: 20 }}>
          <View>
              <Text style={{ color: '#94a3b8', marginBottom: 10 }}>Live Minimap Tracker</Text>
              <canvas ref={canvasRef} width={80} height={80} 
                      style={{ width: 400, height: 400, border: '2px solid #334155', borderRadius: 8, imageRendering: 'pixelated' }} />
          </View>
          <View style={{ flex: 1, backgroundColor: '#1e293b', padding: 20, borderRadius: 8 }}>
              <Text style={{ color: '#f8fafc', fontSize: 16, marginBottom: 10 }}>Actor State Diagnostics</Text>
              <Text style={{ color: '#38bdf8', fontFamily: 'monospace' }}>
                 NPC Task: {useGameStore(s => s.aiState)}
              </Text>
              <Text style={{ color: '#a3e635', fontFamily: 'monospace', marginTop: 10 }}>
                 Stats: Trees Felled {useGameStore(s => s.stats.treesDowned)}, Blocks Modified {useGameStore(s => s.stats.mudPatted)}
              </Text>
          </View>
      </View>
    </View>
  );
}
