import { useGameStore } from '../store';
import { floraCache, FloraItem } from './floraCache';
import { getRiverCenter, getRiverWidth, getTerrainHeight } from './terrain';
import { canGatherMud } from './mudEngine';
import { woodEngine } from './woodEngine';
import { WaterEngine } from './WaterEngine';
import { npcActions } from './npcActions';
import * as THREE from 'three';

const _aiScratchPos = new THREE.Vector3();

export type AIState = 
  | 'IDLE' 
  | 'EAT'
  | 'FIND_TREE' 
  | 'CHOP_TREE' 
  | 'FIND_LOG' 
  | 'DELIVER_WATER' 
  | 'GATHER_MUD'
  | 'FORTIFY_DAM'
  | 'DIG_CHANNEL'
  | 'PLAY'
  | 'WAIT_LOG'
  | 'EXPLORE_FOR_FOOD'
  | 'EXPLORE';

export class BeaverAI {
  state: AIState = 'IDLE';
  targetId: string | null = null;
  targetPos: THREE.Vector3 | null = null;
  damTargetZ: number | null = null;
  channelsDug = 0;  // Track how many lateral channels the beaver has dug
  damsBuilt = 0;
  lastDamBuildCount = 0;
  
  lastThinkTime = 0;
  comboTimer = 0;
  stateStartTime = 0;
  logWaitId: string | null = null;
  macroStep = 0;
  
  stateTimeAccumulator: Record<string, number> = {};
  private lastTickTime = 0;

  transition(newState: AIState, now: number, debugString?: string) {
    this.state = newState;
    this.stateStartTime = now;
    useGameStore.getState().setAITarget(null);
    useGameStore.getState().setAIState(debugString || newState);
  }

  tick(now: number, waterEng: WaterEngine) {
    const gameStore = useGameStore.getState();
    if (!gameStore.autopilot) return;
    
    // Time tracking accumulation natively
    if (this.lastTickTime === 0) this.lastTickTime = now;
    const dt = now - this.lastTickTime;
    this.lastTickTime = now;
    if (!this.stateTimeAccumulator[this.state]) this.stateTimeAccumulator[this.state] = 0;
    this.stateTimeAccumulator[this.state] += dt;
    
    if (now - this.lastThinkTime < 40) return; // 25Hz brain
    this.lastThinkTime = now;

    const pos = new THREE.Vector3(...gameStore.playerPosition);

    if (this.damTargetZ === null) {
      this.damTargetZ = pos.z + 5; // Initial dam site
    }
    const damZ = this.damTargetZ;
    const riverX = getRiverCenter(damZ);
    const buildCount = gameStore.stats.treesDowned + gameStore.stats.sticksPlaced + gameStore.stats.mudPatted;
    
    // Actively seek water leaks (flow/depth) to determine the next construction point!
    let worstX = riverX;
    let worstScore = -1;
    const searchWidth = getRiverWidth() + 10;
    
    for (let x = riverX - searchWidth; x <= riverX + searchWidth; x += 1.5) {
        const depth = waterEng.getWaterDepth(x, damZ);
        const vel = waterEng.getVelocity(x, damZ);
        const speed = Math.sqrt(vel.x**2 + vel.z**2);
        
        const tieBreaker = Math.sin(x * 0.5 + buildCount) * 0.1;
        const score = (depth * 2.5) + (speed * 1.5) + tieBreaker;
        
        if (score > worstScore) {
            worstScore = score;
            worstX = x;
        }
    }
    
    if (worstScore < 0.1) {
       const damOffset = Math.sin(buildCount * 0.8) * (getRiverWidth() - 1);
       worstX = riverX + damOffset;
    }
    
    const damCenter = new THREE.Vector3(worstX, 0, damZ);

    const isDragging = gameStore.draggableLogs.some(l => l.isDragged);
    
    // Macro interruptions
    if (isDragging && this.state !== 'DELIVER_WATER' && this.state !== 'FORTIFY_DAM' && this.state !== 'GATHER_MUD') {
      this.targetPos = null;
      this.transition('DELIVER_WATER', now, 'Dragging log to river!');
    }

    // Boredom logic - Explore if stuck
    if (this.state !== 'IDLE' && this.state !== 'EXPLORE') {
        const maxTime = (this.state === 'CHOP_TREE' || this.state === 'DIG_CHANNEL') ? 25000 : 15000;
        if (now - this.stateStartTime > maxTime) {
            this.targetPos = null;
            this.transition('EXPLORE', now, 'Got bored. Exploring...');
        }
    } else if (this.state === 'EXPLORE' || this.state === 'PLAY' || this.state === 'EXPLORE_FOR_FOOD') {
        if (now - this.stateStartTime > 20000) { 
            this.targetPos = null;
            this.transition('IDLE', now, 'Finished activity.');
        }
    } else if (this.state === 'IDLE') {
        this.stateStartTime = now;
    }

    switch (this.state) {
      case 'IDLE':
        if (Math.random() < 0.15) {
            if (Math.random() < 0.5) {
                 this.transition('EAT', now, 'Hungry! Looking for food.');
            } else {
                 this.macroStep = 0;
                 this.transition('PLAY', now, 'Splish splash! Playing in river!');
            }
        } else {
             const freeLog = gameStore.draggableLogs.find(l => !l.isDragged && !l.isMudded && l.position[1] > -5); 
             if (freeLog) {
                 this.targetId = freeLog.id;
                 this.transition('FIND_LOG', now, 'Found a loose log.');
             } else if (gameStore.inventory.sticks > 4) {
                 this.macroStep = 0;
                 this.transition('FORTIFY_DAM', now, 'Got sticks, packing dam!');
             } else if (buildCount > 8 && this.channelsDug < 4 && Math.random() < 0.3) {
                 // After building some dam, periodically breach the banks!
                 this.macroStep = 0;
                 this.transition('DIG_CHANNEL', now, 'Breaching riverbank to flood the plains!');
             } else if (this.channelsDug >= 4 && buildCount > this.lastDamBuildCount + 15) {
                 this.damTargetZ! -= 15; // Move upstream 15 meters for the next dam
                 this.channelsDug = 0;
                 this.lastDamBuildCount = buildCount;
                 this.damsBuilt++;
                 this.transition('EXPLORE', now, `Migrating upstream! Dam #${this.damsBuilt} complete.`);
             } else if (gameStore.inventory.mud < 4 && Math.random() < 0.4) {
                 this.macroStep = 0;
                 this.transition('GATHER_MUD', now, 'Gathering mud for dam.');
             } else {
                 this.transition('FIND_TREE', now, 'Looking for timber to chop.');
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
                 gameStore.setAITarget(null);
                 if (now > this.comboTimer) {
                   const nx = Math.floor(snack.position[0] / 40);
                   const nz = Math.floor(snack.position[2] / 40);
                   npcActions.eatSnack(snack as any, `${nx},${nz}`);
                   
                   this.comboTimer = now + 400; 
                   this.transition('IDLE', now, 'Yum. Done eating.');
                 }
             } else {
                 gameStore.setAITarget(snack.position);
             }
          } else {
             this.transition('EXPLORE_FOR_FOOD', now, 'No food found. Exploring...');
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
                 if (woodEngine.getSticks(item.id, isBigTree) <= 0) continue; 
                 
                 const waterH = waterEng.getSurfaceHeight(item.position[0], item.position[2]);
                 if (waterH > item.position[1] + 0.5) continue; 
                 
                 _aiScratchPos.set(item.position[0], item.position[1], item.position[2]);
                 let d = pos.distanceToSquared(_aiScratchPos);
                 if (isBigTree && gameStore.stats.massiveTreesFelled < 2) {
                     d -= 150;
                 }
                 
                 if (d < minD) { minD = d; nearest = item; }
               }
             }
           }
           if (nearest) {
              const nearestItem = nearest;
              const tv = new THREE.Vector3(...nearestItem.position);
              const dist = pos.distanceTo(tv);
              const isBig = nearestItem.type === 'big';
              const hitRadius = isBig ? 3.8 : 2.8;

              const actionRadius = (this.state === 'CHOP_TREE') ? hitRadius + 0.2 : hitRadius;

              if (dist <= actionRadius) {
                 gameStore.setAITarget(null);
                 if (this.state !== 'CHOP_TREE') this.transition('CHOP_TREE', now, 'Chopping tree!');
                 
                 if (now > this.comboTimer) {
                     const nx = Math.floor(nearestItem.position[0] / 40);
                     const nz = Math.floor(nearestItem.position[2] / 40);
                     const res = npcActions.chopTree(pos, nearestItem as any, `${nx},${nz}`);
                     this.comboTimer = now + 500; 
                     
                     if (res.felled) {
                      if (res.newLogId) { 
                          this.logWaitId = res.newLogId;
                          this.transition('WAIT_LOG', now, 'Watching timber fall...');
                      } else {
                          this.macroStep = 0;
                          this.transition('FORTIFY_DAM', now, 'Timber felled. Gathering sticks...');
                      }
                  }   
                 }
              } else {
                 gameStore.setAITarget(nearest.position);
                 if (this.state !== 'FIND_TREE') this.transition('FIND_TREE', now, 'Walking to tree.');
              }
           } else {
              gameStore.setAITarget(null);
              this.transition('EXPLORE', now, 'No timber found. Migrating...');
           }
        } break;

       case 'FIND_LOG': {
           const logId = this.targetId;
           const log = gameStore.draggableLogs.find(l => l.id === logId && !l.isDragged);
           if (!log || log.isMudded) {
             this.transition('IDLE', now, 'Log disappeared or stuck.');
             break;
           }
           _aiScratchPos.set(log.position[0], log.position[1], log.position[2]);
           const d = pos.distanceTo(_aiScratchPos);
           if (d <= 5) {
               gameStore.setAITarget(null);
               if (now > this.comboTimer) {
                 npcActions.pickupLog(log.id);
                 this.comboTimer = now + 150;
                 this.transition('DELIVER_WATER', now, 'Carrying log to dam!');
               }
           } else {
               gameStore.setAITarget(log.position);
           }
        } break;
        
      case 'WAIT_LOG': {
          if (now - this.stateStartTime > 1600) { 
              if (this.logWaitId) {
                  npcActions.pickupLog(this.logWaitId);
                  this.logWaitId = null;
              }
              this.transition('DELIVER_WATER', now, 'Hauling massive log to dam site.');
          }
      } break;
      
      case 'DELIVER_WATER': {
           const dX = pos.x - damCenter.x;
           const dZ = pos.z - damCenter.z;
           const distSq2D = dX * dX + dZ * dZ;

           if (!isDragging) {
              this.macroStep = 0;
              if (distSq2D > 36) {
                this.transition('IDLE', now, 'Log lost...');
              } else {
                this.transition('FORTIFY_DAM', now, 'Log placed! Fortifying...');
              }
              break;
           }
           if (distSq2D < 9) {
               gameStore.setAITarget(null);
               if (now > this.comboTimer) {
                  const draggedLog = gameStore.draggableLogs.find(l => l.isDragged);
                  if (draggedLog) {
                     npcActions.dropLog(draggedLog.id);
                  }
                  this.comboTimer = now + 200;
               }
           } else {
               if (Math.abs(dZ) > 15) {
                   const bankSide = pos.x > getRiverCenter(pos.z) ? 1 : -1;
                   const bankX = getRiverCenter(pos.z) + bankSide * (getRiverWidth() + 3);
                   let routeZ = pos.z > damCenter.z ? pos.z - 8 : pos.z + 8;
                   gameStore.setAIState('Hauling log along riverbank.');
                   gameStore.setAITarget([bankX, getTerrainHeight(bankX, routeZ), routeZ]);
               } else {
                   gameStore.setAIState('Dragging log into the river.');
                   gameStore.setAITarget([damCenter.x, damCenter.y, damCenter.z]);
               }
           }
        } break;

      case 'FORTIFY_DAM': {
            if (gameStore.inventory.mud < 4) {
                this.macroStep = 0;
                this.transition('GATHER_MUD', now, 'Need mud! Fetching...');
                break;
            }
            
            const dX = pos.x - damCenter.x;
            const dZ = pos.z - damCenter.z;
            if (dX * dX + dZ * dZ > 16) {
                gameStore.setAIState('Walking to dam site to fortify.');
                gameStore.setAITarget([damCenter.x, damCenter.y, damCenter.z]);
                break;
            }
            
            gameStore.setAITarget(null);
            const targetCoords = { x: damCenter.x, z: damCenter.z };
            
            if (this.macroStep === 0) {
               if (now > this.comboTimer) {
                 gameStore.setAIState('Fortifying: Packing Mud Base');
                 npcActions.placeMud(targetCoords);
                 this.comboTimer = now + 600;
                 
                 const tHeight = getTerrainHeight(targetCoords.x, targetCoords.z);
                 const waterSurface = waterEng.getSurfaceHeight(targetCoords.x, targetCoords.z);
                 
                 if (waterSurface <= -50 || tHeight > waterSurface - 0.1) {
                     this.macroStep++;
                 }
               }
            } else if (this.macroStep === 1) {
               if (now > this.comboTimer) {
                 gameStore.setAIState('Fortifying: Weaving Sticks');
                 const pRot = gameStore.playerRotation;
                 npcActions.placeStick(pRot, targetCoords);
                 this.comboTimer = now + 600;
                 this.macroStep++;
               }
            } else if (this.macroStep === 2) {
               if (now > this.comboTimer) {
                 gameStore.setAIState('Fortifying: Sealing Composite');
                 npcActions.placeMud(targetCoords);
                 this.comboTimer = now + 600;
                 this.macroStep++;
               }
            } else {
                // Occasionally transition to channel digging instead of idle
                if (this.channelsDug < 4 && buildCount > 10 && Math.random() < 0.25) {
                    this.macroStep = 0;
                    this.transition('DIG_CHANNEL', now, 'Dam sealed. Now breaching banks!');
                } else {
                    this.transition('IDLE', now, 'Dam composite built.');
                }
             }
        } break;

      case 'GATHER_MUD': {
            // Find nearest mud-eligible cell: check bank + nearby flooded areas
            const rw = getRiverWidth();
            const rc = getRiverCenter(pos.z);
            const bankDir = pos.x > rc ? 1 : -1;
            
            // Search for nearest gatherable mud in a spiral outward from the beaver
            let bestTarget: THREE.Vector3 | null = null;
            let bestDistSq = Infinity;
            // Increased search radius to ensure it finds mud away from the dam
            for (let searchR = 2; searchR <= 30; searchR += 2) {
              for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
                const sx = pos.x + Math.cos(angle) * searchR;
                const sz = pos.z + Math.sin(angle) * searchR;
                if (canGatherMud(sx, sz)) {
                  // Do not gather mud from our own dam!
                  // Evaluate distance to the dam building site
                  const distToDamSq = (sx - damCenter.x) ** 2 + (sz - damCenter.z) ** 2;
                  if (distToDamSq > 64) { // Must be at least 8 units away
                    const dSq = (sx - pos.x) ** 2 + (sz - pos.z) ** 2;
                    if (dSq < bestDistSq) {
                      bestDistSq = dSq;
                      bestTarget = new THREE.Vector3(sx, 0, sz);
                    }
                  }
                }
              }
              if (bestTarget) break; // Found mud at this radius, stop searching
            }
            
            // Fallback: use the traditional river bank target
            if (!bestTarget) {
              bestTarget = new THREE.Vector3(rc + bankDir * (rw + 2), 0, pos.z);
            }
            
            if (Math.abs(pos.x - bestTarget.x) > 3 || Math.abs(pos.z - bestTarget.z) > 3) {
                gameStore.setAIState('Walking to mud source.');
                gameStore.setAITarget([bestTarget.x, bestTarget.y, bestTarget.z]);
            } else {
                gameStore.setAITarget(null);
                if (now > this.comboTimer) {
                    gameStore.setAIState('Digging mud!');
                    
                    const pRot = gameStore.playerRotation;
                    npcActions.digMud({
                       x: pos.x + Math.sin(pRot + Math.PI) * 2,
                       z: pos.z + Math.cos(pRot + Math.PI) * 2
                    });
                    
                    this.comboTimer = now + 800; 
                    this.macroStep++;
                    
                    if (gameStore.inventory.mud >= 5 || this.macroStep > 6) {
                        this.transition('IDLE', now, 'Mud gathered.'); 
                    }
                }
            }
        } break;

      case 'DIG_CHANNEL': {
            // Breach the riverbank UPSTREAM of the dam to create a floodplain
            const channelZ = damZ - 5 - this.channelsDug * 8;
            const bankSide = this.channelsDug % 2 === 0 ? 1 : -1;
            const rc2 = getRiverCenter(channelZ);
            const rw2 = getRiverWidth();
            const channelX = rc2 + bankSide * (rw2 + 1 + this.macroStep * 1.5);
            const channelTarget = new THREE.Vector3(channelX, 0, channelZ);
            
            const distCh = pos.distanceTo(channelTarget);
            if (distCh > 3) {
                gameStore.setAIState(`Marching to breach point ${this.channelsDug + 1}`);
                gameStore.setAITarget([channelTarget.x, channelTarget.y, channelTarget.z]);
            } else {
                gameStore.setAITarget(null);
                if (now > this.comboTimer) {
                    gameStore.setAIState(`Digging channel #${this.channelsDug + 1}!`);
                    npcActions.digMud({ x: channelX, z: channelZ });
                    npcActions.digMud({ x: channelX + bankSide * 1.5, z: channelZ });
                    this.comboTimer = now + 600;
                    this.macroStep++;
                    
                    if (this.macroStep >= 5) {
                        this.channelsDug++;
                        this.macroStep = 0;
                        this.transition('IDLE', now, `Channel breached! Total: ${this.channelsDug}`);
                    }
                }
            }
        } break;

      case 'EXPLORE_FOR_FOOD':
      case 'EXPLORE': {
          if (!this.targetPos) {
               const dir = Math.random() > 0.5 ? 1 : -1;
               const ez = pos.z + dir * (20 + Math.random() * 20);
               const bankSide = Math.random() > 0.5 ? 1 : -1;
               const ex = getRiverCenter(ez) + bankSide * (getRiverWidth() + 2 + Math.random() * 5);
               this.targetPos = new THREE.Vector3(
                   ex, getTerrainHeight(ex, ez), ez
               );
          }
          if (pos.distanceToSquared(this.targetPos) < 9) {
               this.targetPos = null;
               if (this.state === 'EXPLORE_FOR_FOOD') {
                   this.transition('EAT', now, 'Arrived at new sector. Looking for food...');
               } else {
                   this.transition('IDLE', now, 'Done exploring.');
               }
          } else {
               gameStore.setAITarget([this.targetPos.x, this.targetPos.y, this.targetPos.z]);
          }
        } break;

      case 'PLAY': {
          if (!this.targetPos) {
             const ex = getRiverCenter(pos.z) + (Math.random() - 0.5) * 6; 
             const ez = pos.z + (Math.random() - 0.5) * 10;
             this.targetPos = new THREE.Vector3(ex, getTerrainHeight(ex, ez), ez);
          }
          const dx = pos.x - this.targetPos.x;
          const dz = pos.z - this.targetPos.z;
          if (dx * dx + dz * dz < 9) {
             gameStore.setAITarget(null);
             if (now > this.comboTimer) {
                 gameStore.setVirtualButton('jump', true);
                 setTimeout(() => useGameStore.getState().setVirtualButton('jump', false), 200);
                 this.macroStep++;
                 this.comboTimer = now + 600; 
                 if (this.macroStep > 4) { 
                    this.targetPos = null;
                    this.transition('IDLE', now, 'Done playing.');
                 }
             }
          } else {
             gameStore.setAITarget([this.targetPos.x, this.targetPos.y, this.targetPos.z]);
          }
      } break;
    }
  }
}

export const globalBeaverAI = new BeaverAI();
