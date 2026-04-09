import { useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGameStore } from '../store';
import { floraCache, FloraItem } from '../utils/floraCache';
import { getRiverCenter, getRiverWidth, getTerrainHeight } from '../utils/terrain';
import { woodEngine } from '../utils/woodEngine';
import { waterEngine } from '../utils/WaterEngine';
import { npcActions } from '../utils/npcActions';
import * as THREE from 'three';

const _aiScratchPos = new THREE.Vector3();

type AIState = 
  | 'IDLE' 
  | 'EAT'
  | 'FIND_TREE' 
  | 'CHOP_TREE' 
  | 'FIND_LOG' 
  | 'DELIVER_WATER' 
  | 'GATHER_MUD'
  | 'FORTIFY_DAM'
  | 'PLAY'
  | 'WAIT_LOG'
  | 'EXPLORE_FOR_FOOD'
  | 'EXPLORE';

export function BeaverBrain() {
  const { autopilot, setAITarget, setAIState } = useGameStore();

  const stateRef = useRef<AIState>('IDLE');
  const targetIdRef = useRef<string | null>(null);
  const targetPosRef = useRef<THREE.Vector3 | null>(null);
  const damTargetZ = useRef<number | null>(null);
  
  const lastThinkTime = useRef(0);
  const comboTimer = useRef(0);
  const stateStartTime = useRef<number>(0);
  const logWaitId = useRef<string | null>(null);
  const macroStep = useRef(0);

  // Helper to sync state to the new debug store string
  const transition = (newState: AIState, debugString?: string) => {
    stateRef.current = newState;
    stateStartTime.current = performance.now();
    setAITarget(null); // Always clear physical target on transition
    setAIState(debugString || newState);
  }

  useEffect(() => {
    if (!autopilot) {
      setAITarget(null);
      transition('IDLE', 'Offline');
    }
  }, [autopilot]);

  useFrame(() => {
    if (!autopilot) return;
    
    const now = performance.now();
    if (now - lastThinkTime.current < 40) return; // 25Hz brain
    lastThinkTime.current = now;

    const gameRoot = useGameStore.getState();
    const pos = new THREE.Vector3(...gameRoot.playerPosition);

    if (damTargetZ.current === null) {
      damTargetZ.current = pos.z + 5; // Initial dam site
    }
    const damZ = damTargetZ.current;
    const riverX = getRiverCenter(damZ);
    const buildCount = gameRoot.stats.treesDowned + gameRoot.stats.sticksPlaced + gameRoot.stats.mudPatted;
    
    // Actively seek water leaks (flow/depth) to determine the next construction point!
    let worstX = riverX;
    let worstScore = -1;
    const searchWidth = getRiverWidth() + 10;
    
    for (let x = riverX - searchWidth; x <= riverX + searchWidth; x += 1.5) {
        // Measure the flow at the dam line and slightly upstream
        const depth = waterEngine.getWaterDepth(x, damZ);
        const vel = waterEngine.getVelocity(x, damZ);
        const speed = Math.sqrt(vel.x**2 + vel.z**2);
        
        // Score values high depth (spillover) and high speed (leaks)
        // Add a slight tie-breaker based on position and buildCount to prevent stacking perfectly in one spot
        const tieBreaker = Math.sin(x * 0.5 + buildCount) * 0.1;
        const score = (depth * 2.5) + (speed * 1.5) + tieBreaker;
        
        if (score > worstScore) {
            worstScore = score;
            worstX = x;
        }
    }
    
    // If the river is somehow completely dry, fallback to visual sweeping across the center
    if (worstScore < 0.1) {
       const damOffset = Math.sin(buildCount * 0.8) * (getRiverWidth() - 1);
       worstX = riverX + damOffset;
    }
    
    const damCenter = new THREE.Vector3(worstX, 0, damZ);

    const isDragging = gameRoot.draggableLogs.some(l => l.isDragged);
    
    // Macro interruptions
    if (isDragging && stateRef.current !== 'DELIVER_WATER' && stateRef.current !== 'FORTIFY_DAM' && stateRef.current !== 'GATHER_MUD') {
      targetPosRef.current = null;
      transition('DELIVER_WATER', 'Dragging log to river!');
    }

    // Boredom logic - Explore if stuck
    if (stateRef.current !== 'IDLE' && stateRef.current !== 'EXPLORE') {
        const maxTime = stateRef.current === 'CHOP_TREE' ? 25000 : 15000;
        if (now - stateStartTime.current > maxTime) {
            targetPosRef.current = null;
            transition('EXPLORE', 'Got bored. Exploring...');
        }
    } else if (stateRef.current === 'EXPLORE' || stateRef.current === 'PLAY' || stateRef.current === 'EXPLORE_FOR_FOOD') {
        if (now - stateStartTime.current > 20000) { // 20 seconds max to explore/play
            targetPosRef.current = null;
            // Bailing out entirely if we hit the 20 second hard-cap
            transition('IDLE', 'Finished activity.');
        }
    } else if (stateRef.current === 'IDLE') {
        stateStartTime.current = now;
    }

    switch (stateRef.current) {
      case 'IDLE':
        if (Math.random() < 0.25) {
            if (Math.random() < 0.5) {
                 transition('EAT', 'Hungry! Looking for food.');
            } else {
                 macroStep.current = 0;
                 transition('PLAY', 'Splish splash! Playing in river!');
            }
        } else {
             const freeLog = gameRoot.draggableLogs.find(l => !l.isDragged && !l.isMudded && l.position[1] > -5); 
             if (freeLog) {
                 targetIdRef.current = freeLog.id;
                 transition('FIND_LOG', 'Found a loose log.');
             } else if (gameRoot.inventory.sticks > 4) {
                 macroStep.current = 0;
                 transition('FORTIFY_DAM', 'Got sticks, packing dam!');
             } else if (gameRoot.inventory.mud < 4 && Math.random() < 0.4) {
                 macroStep.current = 0;
                 transition('GATHER_MUD', 'Gathering mud for dam.');
             } else {
                 transition('FIND_TREE', 'Looking for timber to chop.');
             }
        }
        break;

      case 'EAT': {
          let snack: FloraItem | null = null;
          let minD = Infinity;
          
          const cx = Math.floor(pos.x / 40);
          const cz = Math.floor(pos.z / 40);
          
          for (const chunk of floraCache.getClosestChunks(cx, cz, 2)) {
            for (const item of chunk) {
              if (item.type === 'lily' || item.type === 'cattail' || item.type === 'sapling') {
                _aiScratchPos.set(item.position[0], item.position[1], item.position[2]);
                const d = pos.distanceToSquared(_aiScratchPos);
                if (d < minD) { minD = d; snack = item; }
              }
            }
          }
          if (snack) {
             if (minD < 9) { 
                 setAITarget(null);
                 if (now > comboTimer.current) {
                   npcActions.eatSnack(snack as any, '0,0'); // We don't track chunkKeys for npc snack eat perfectly yet, wait, let's just trigger stats so doing it without chunkKey causes error? No, eatSnack uses chunkKey, let's compute it.
                   // It's easier: just run the logic:
                   const cx = Math.floor(snack.position[0] / 40);
                   const cz = Math.floor(snack.position[2] / 40);
                   npcActions.eatSnack(snack as any, `${cx},${cz}`);
                   
                   comboTimer.current = now + 400; // time to chew
                   transition('IDLE', 'Yum. Done eating.');
                 }
             } else {
                 setAITarget(snack.position);
             }
          } else {
             transition('EXPLORE_FOR_FOOD', 'No food found. Exploring...');
          }
        } break;

      case 'FIND_TREE':
      case 'CHOP_TREE': {
           let nearest: FloraItem | null = null;
           let minD = Infinity;
           
           const cx = Math.floor(pos.x / 40);
           const cz = Math.floor(pos.z / 40);
           
           for (const chunk of floraCache.getClosestChunks(cx, cz, 2)) {
             for (const item of chunk) {
               if (item.type === 'big' || item.type === 'small') {
                 const isBigTree = item.type === 'big';
                 if (woodEngine.getSticks(item.id, isBigTree) <= 0) continue; // Skip felled trees
                 
                 // Ignore trees that spawn underwater
                 const waterH = waterEngine.getSurfaceHeight(item.position[0], item.position[2]);
                 if (waterH > item.position[1] + 0.5) continue; // Flooded if water is above trunk base
                 
                 _aiScratchPos.set(item.position[0], item.position[1], item.position[2]);
                 let d = pos.distanceToSquared(_aiScratchPos);
                 // Prioritize big oaks for the foundational dam base, but don't walk across the entire map
                 if (isBigTree && gameRoot.stats.massiveTreesFelled < 2) {
                     d -= 150;
                 }
                 
                 if (d < minD) { minD = d; nearest = item; }
               }
             }
           }
           if (nearest) {
              const nearestItem = nearest; // Typecast assert
              const tv = new THREE.Vector3(...nearestItem.position);
              const dist = pos.distanceTo(tv);
              const isBig = nearestItem.type === 'big';
              const hitRadius = isBig ? 3.8 : 2.8; // Actually 4 and 3 in Interaction.tsx, shrink slightly to guarantee hit

              // Give hysteresis: if we were CHOP_TREE, allow a slightly larger distance so we don't flutter
              const actionRadius = (stateRef.current === 'CHOP_TREE') ? hitRadius + 0.2 : hitRadius;

              if (dist <= actionRadius) {
                 setAITarget(null);
                 if (stateRef.current !== 'CHOP_TREE') transition('CHOP_TREE', 'Chopping tree!');
                 
                 if (now > comboTimer.current) {
                     const cx = Math.floor(nearestItem.position[0] / 40);
                     const cz = Math.floor(nearestItem.position[2] / 40);
                     const res = npcActions.chopTree(pos, nearestItem as any, `${cx},${cz}`);
                     comboTimer.current = now + 500; // wait between chops
                     
                     if (res.felled) {
                      if (res.newLogId) { 
                          logWaitId.current = res.newLogId;
                          transition('WAIT_LOG', 'Watching timber fall...');
                      } else {
                          macroStep.current = 0;
                          transition('FORTIFY_DAM', 'Timber felled. Gathering sticks...');
                      }
                  }   
                 }
              } else {
                 setAITarget(nearest.position);
                 if (stateRef.current !== 'FIND_TREE') transition('FIND_TREE', 'Walking to tree.');
              }
           } else {
              setAITarget(null);
              transition('EXPLORE', 'No timber found. Migrating...');
           }
        } break;

       case 'FIND_LOG': {
           const logId = targetIdRef.current;
           const log = gameRoot.draggableLogs.find(l => l.id === logId && !l.isDragged);
           if (!log || log.isMudded) {
             transition('IDLE', 'Log disappeared or stuck.');
             break;
           }
           _aiScratchPos.set(log.position[0], log.position[1], log.position[2]);
           const d = pos.distanceTo(_aiScratchPos);
           if (d <= 5) {
               setAITarget(null);
               if (now > comboTimer.current) {
                 npcActions.pickupLog(log.id);
                 comboTimer.current = now + 150;
                 transition('DELIVER_WATER', 'Carrying log to dam!');
               }
           } else {
               setAITarget(log.position);
           }
        } break;
        
      case 'WAIT_LOG': {
          if (now - stateStartTime.current > 1600) { // Give the physics engine 1.6 seconds to let the log fall visually
              if (logWaitId.current) {
                  npcActions.pickupLog(logWaitId.current);
                  logWaitId.current = null;
              }
              transition('DELIVER_WATER', 'Hauling massive log to dam site.');
          }
      } break;
      
      case 'DELIVER_WATER': {
           const dX = pos.x - damCenter.x;
           const dZ = pos.z - damCenter.z;
           const distSq2D = dX * dX + dZ * dZ;

           if (!isDragging) {
              macroStep.current = 0;
              // If we accidentally dropped it somewhere else or logic glitched, reset
              if (distSq2D > 36) {
                transition('IDLE', 'Log lost...');
              } else {
                transition('FORTIFY_DAM', 'Log placed! Fortifying...');
              }
              break;
           }
           if (distSq2D < 9) {
               setAITarget(null);
               if (now > comboTimer.current) {
                  const draggedLog = gameRoot.draggableLogs.find(l => l.isDragged);
                  if (draggedLog) {
                     npcActions.dropLog(draggedLog.id);
                  }
                  comboTimer.current = now + 200;
               }
           } else {
               // If we are hauling from far away (more than 15 z-units), route along the solid river bank 
               // so we don't try to swim upstream against the water physics with a massive oak!
               if (Math.abs(dZ) > 15) {
                   const bankSide = pos.x > getRiverCenter(pos.z) ? 1 : -1;
                   const bankX = getRiverCenter(pos.z) + bankSide * (getRiverWidth() + 3);
                   // Walk forward along the bank before cutting into the river
                   let routeZ = pos.z > damCenter.z ? pos.z - 8 : pos.z + 8;
                   setAIState('Hauling log along riverbank.');
                   setAITarget([bankX, getTerrainHeight(bankX, routeZ), routeZ]);
               } else {
                   setAIState('Dragging log into the river.');
                   setAITarget([damCenter.x, damCenter.y, damCenter.z]);
               }
           }
        } break;

      case 'FORTIFY_DAM': {
            if (gameRoot.inventory.mud < 4) { // Get extra mud
                macroStep.current = 0;
                transition('GATHER_MUD', 'Need mud! Fetching...');
                break;
            }
            
            // Check if we are at the dam site ignoring vertical height
            const dX = pos.x - damCenter.x;
            const dZ = pos.z - damCenter.z;
            if (dX * dX + dZ * dZ > 16) {
                setAIState('Walking to dam site to fortify.');
                setAITarget([damCenter.x, damCenter.y, damCenter.z]);
                break;
            }
            
            setAITarget(null);
            // Place directly on the dam center (so we don't rely on player rotation direction)
            const targetCoords = { x: damCenter.x, z: damCenter.z };
            
            if (macroStep.current === 0) {
               if (now > comboTimer.current) {
                 setAIState('Fortifying: Packing Mud Base');
                 npcActions.placeMud(targetCoords);
                 comboTimer.current = now + 600;
                 
                 // CRITICAL ECOLOGY RULE: Only advance to Sticks if the mud is exposed above water!
                 // Otherwise, looping this step will force the beaver to fetch more mud and build the pillar higher.
                 const tHeight = getTerrainHeight(targetCoords.x, targetCoords.z);
                 // We use the absolute baseline water surface (or current depth). If tHeight is high enough to poke out, we can stick it!
                 const waterSurface = waterEngine.getSurfaceHeight(targetCoords.x, targetCoords.z);
                 
                 // If the terrain is higher than the water (or water is mostly gone), advance to sticks!
                 if (waterSurface <= -50 || tHeight > waterSurface - 0.1) {
                     macroStep.current++;
                 } else {
                     // Stay on macroStep 0. If inventory runs out, the outer loop will trigger GATHER_MUD!
                 }
               }
            } else if (macroStep.current === 1) {
               if (now > comboTimer.current) {
                 setAIState('Fortifying: Weaving Sticks');
                 const pRot = gameRoot.playerRotation;
                 npcActions.placeStick(pRot, targetCoords);
                 comboTimer.current = now + 600;
                 macroStep.current++;
               }
            } else if (macroStep.current === 2) {
               if (now > comboTimer.current) {
                 setAIState('Fortifying: Sealing Composite');
                 npcActions.placeMud(targetCoords);
                 comboTimer.current = now + 600;
                 macroStep.current++;
               }
            } else {
               transition('IDLE', 'Dam composite built.');
            }
        } break;

      case 'GATHER_MUD': {
            const rw = getRiverWidth();
            const rc = getRiverCenter(pos.z);
            const bankDir = pos.x > rc ? 1 : -1;
            const bankTarget = new THREE.Vector3(rc + bankDir * (rw + 2), 0, pos.z);
            const distSq = pos.distanceToSquared(bankTarget);
            
            // It could be above or below water
            if (Math.abs(pos.x - bankTarget.x) > 3 || Math.abs(pos.z - bankTarget.z) > 3) {
                setAIState('Walking to bank for mud.');
                setAITarget([bankTarget.x, bankTarget.y, bankTarget.z]);
            } else {
                setAITarget(null);
                if (now > comboTimer.current) {
                    setAIState('Digging mud!');
                    
                    const pRot = gameRoot.playerRotation;
                    npcActions.digMud({
                       x: pos.x + Math.sin(pRot + Math.PI) * 2,
                       z: pos.z + Math.cos(pRot + Math.PI) * 2
                    });
                    
                    comboTimer.current = now + 800; // longer dig combo
                    macroStep.current++;
                    
                    if (gameRoot.inventory.mud >= 5 || macroStep.current > 6) {
                        transition('IDLE', 'Mud gathered.'); 
                    }
                }
            }
        } break;

      case 'EXPLORE_FOR_FOOD':
      case 'EXPLORE': {
          if (!targetPosRef.current) {
               // Wander up or down the river ecosystem looking for fresh resources
               const dir = Math.random() > 0.5 ? 1 : -1;
               const ez = pos.z + dir * (20 + Math.random() * 20);
               // Pick a bank (left or right) so they don't swim straight up the middle of the water current
               const bankSide = Math.random() > 0.5 ? 1 : -1;
               const ex = getRiverCenter(ez) + bankSide * (getRiverWidth() + 2 + Math.random() * 5);
               targetPosRef.current = new THREE.Vector3(
                   ex, getTerrainHeight(ex, ez), ez
               );
          }
          if (pos.distanceToSquared(targetPosRef.current) < 9) {
               targetPosRef.current = null;
               if (stateRef.current === 'EXPLORE_FOR_FOOD') {
                   transition('EAT', 'Arrived at new sector. Looking for food...');
               } else {
                   transition('IDLE', 'Done exploring.');
               }
          } else {
               setAITarget([targetPosRef.current.x, targetPosRef.current.y, targetPosRef.current.z]);
          }
        } break;

      case 'PLAY': {
          if (!targetPosRef.current) {
             // Find nearby water to jump in
             const ex = getRiverCenter(pos.z) + (Math.random() - 0.5) * 6; // middle of river
             const ez = pos.z + (Math.random() - 0.5) * 10;
             targetPosRef.current = new THREE.Vector3(ex, getTerrainHeight(ex, ez), ez);
          }
          const dx = pos.x - targetPosRef.current.x;
          const dz = pos.z - targetPosRef.current.z;
          if (dx * dx + dz * dz < 9) {
             setAITarget(null);
             if (now > comboTimer.current) {
                 useGameStore.getState().setVirtualButton('jump', true);
                 setTimeout(() => useGameStore.getState().setVirtualButton('jump', false), 200);
                 macroStep.current++;
                 comboTimer.current = now + 600; // time between jumps
                 if (macroStep.current > 4) { // jump seq done
                    targetPosRef.current = null;
                    transition('IDLE', 'Done playing.');
                 }
             }
          } else {
             setAITarget([targetPosRef.current.x, targetPosRef.current.y, targetPosRef.current.z]);
          }
      } break;
    }
  });

  return null;
}
