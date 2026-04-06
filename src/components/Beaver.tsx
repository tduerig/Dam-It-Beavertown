import { useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useKeyboard } from '../utils/useKeyboard';
import { getTerrainHeight } from '../utils/terrain';
import { waterEngine } from '../utils/WaterEngine';
import { useGameStore } from '../store';
import { BRANCH_CONFIGS } from './DraggableLogs';
import { soundEngine } from '../utils/SoundEngine';

const SPEED = 5;
const JUMP_FORCE = 8;
const GRAVITY = 20;

// Pre-allocated scratch objects (AP-1 fix: eliminates per-frame GC pressure)
const _moveDir = new THREE.Vector3();
const _rotatedMove = new THREE.Vector3();
const _cameraOffset = new THREE.Vector3();
const _targetCameraPos = new THREE.Vector3();
const _logMatrix = new THREE.Matrix4();
const _branchMatrix = new THREE.Matrix4();
const _bPos = new THREE.Vector3();
const _bQuat = new THREE.Quaternion();
const _bScale = new THREE.Vector3();
const _bDir = new THREE.Vector3();
const _logEulerScratch = new THREE.Euler();
const _logQuatScratch = new THREE.Quaternion();
const _logScaleScratch = new THREE.Vector3(1, 1, 1);
const _logPosScratch = new THREE.Vector3();

// Spatial hash for O(1) block collision lookups
const BLOCK_CELL_SIZE = 2; // 2-unit grid cells
function blockHashKey(x: number, z: number): string {
  return `${Math.floor(x / BLOCK_CELL_SIZE)},${Math.floor(z / BLOCK_CELL_SIZE)}`;
}

function buildBlockHash(blocks: any[]): Map<string, any[]> {
  const hash = new Map<string, any[]>();
  for (const block of blocks) {
    const key = blockHashKey(block.position[0], block.position[2]);
    let arr = hash.get(key);
    if (!arr) { arr = []; hash.set(key, arr); }
    arr.push(block);
  }
  return hash;
}

function getBlocksNear(hash: Map<string, any[]>, x: number, z: number): any[] {
  // Check 3×3 neighborhood of grid cells to catch blocks near cell boundaries
  const cx = Math.floor(x / BLOCK_CELL_SIZE);
  const cz = Math.floor(z / BLOCK_CELL_SIZE);
  let result: any[] = [];
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const key = `${cx + dx},${cz + dz}`;
      const arr = hash.get(key);
      if (arr) result = result.concat(arr);
    }
  }
  return result;
}

export function Beaver() {
  const groupRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const tailRef = useRef<THREE.Group>(null);
  const armLRef = useRef<THREE.Group>(null);
  const armRRef = useRef<THREE.Group>(null);
  
  const { camera } = useThree();
  const keys = useKeyboard();
  const setPlayerPosition = useGameStore((state) => state.setPlayerPosition);
  const setPlayerRotation = useGameStore((state) => state.setPlayerRotation);

  const velocity = useRef(new THREE.Vector3());
  const isGrounded = useRef(true);

  const lastWeeTime = useRef(0);
  const lastFrameTime = useRef(performance.now());
  
  // Cached spatial hash for block collision — rebuilt only when blocks change
  const blockHashRef = useRef<Map<string, any[]>>(new Map());
  const lastBlocksRef = useRef<any[] | null>(null);

  useFrame((state, delta) => {
    const { gameState } = useGameStore.getState();
    if (gameState !== 'playing') return;

    const now = performance.now();
    // Use custom delta, strongly clamped to 0.05 to prevent physics springs from EXPLODING during initial render lag
    const dt = Math.min((now - lastFrameTime.current) / 1000, 0.05);
    lastFrameTime.current = now;

    if (!groupRef.current || !bodyRef.current || !headRef.current || !tailRef.current || !armLRef.current || !armRRef.current) return;

    const pos = groupRef.current.position;
    const terrainHeight = getTerrainHeight(pos.x, pos.z);
    
    const { 
      cameraAngle, cameraPitch, setCameraAngle, setCameraPitch, rainIntensity, setRainIntensity,
      virtualJoystick, virtualCamera, virtualButtons 
    } = useGameStore.getState();

    // Build/cache spatial hash for block collision (rebuild only when blocks change)
    const placedBlocks = useGameStore.getState().placedBlocks;
    if (placedBlocks !== lastBlocksRef.current) {
      blockHashRef.current = buildBlockHash(placedBlocks);
      lastBlocksRef.current = placedBlocks;
    }
    const blockHash = blockHashRef.current;

    // Check if in water for speed boost — O(1) spatial hash lookup instead of O(N)
    let currentGroundY = terrainHeight + 0.5;
    const nearbyBlocks = getBlocksNear(blockHash, pos.x, pos.z);
    for (const block of nearbyBlocks) {
      if (Math.abs(pos.x - block.position[0]) < 1.0 && Math.abs(pos.z - block.position[2]) < 1.0) {
        const blockTopY = block.position[1] + (block.type === 'mud' ? 0.25 : 0.4);
        currentGroundY = Math.max(currentGroundY, blockTopY + 0.5);
      }
    }
    const currentWaterHeight = waterEngine.getSurfaceHeight(pos.x, pos.z);
    const inWater = currentWaterHeight > currentGroundY - 0.5;
    
    // Movement
    const moveDir = _moveDir.set(0, 0, 0);
    if (keys['KeyW']) moveDir.z -= 1;
    if (keys['KeyS']) moveDir.z += 1;
    if (keys['KeyA']) moveDir.x -= 1;
    if (keys['KeyD']) moveDir.x += 1;
    
    if (virtualJoystick.x !== 0 || virtualJoystick.y !== 0) {
      moveDir.x += virtualJoystick.x;
      moveDir.z += virtualJoystick.y;
    }

    // Camera Controls
    if (keys['ArrowLeft']) setCameraAngle(cameraAngle - 2 * dt);
    if (keys['ArrowRight']) setCameraAngle(cameraAngle + 2 * dt);
    if (keys['ArrowUp']) setCameraPitch(cameraPitch + 2 * dt);
    if (keys['ArrowDown']) setCameraPitch(cameraPitch - 2 * dt);
    
    if (virtualCamera.x !== 0) setCameraAngle(cameraAngle + virtualCamera.x * 2 * dt);
    if (virtualCamera.y !== 0) setCameraPitch(cameraPitch - virtualCamera.y * 2 * dt);

    // Rain Controls
    if (keys['Equal'] || keys['NumpadAdd']) setRainIntensity(rainIntensity + 0.5 * dt);
    if (keys['Minus'] || keys['NumpadSubtract']) setRainIntensity(rainIntensity - 0.5 * dt);

    const isCrouching = keys['ShiftLeft'] || keys['ShiftRight'] || keys['KeyC'] || virtualButtons.crouch;
    const isJumping = keys['Space'] || virtualButtons.jump;
    const isDragging = useGameStore.getState().draggableLogs.some(l => l.isDragged);

    // Determine speed based on state
    let currentSpeed = SPEED;
    if (inWater) {
      currentSpeed = SPEED * 3.5; // Much faster in water to swim upstream
      if (isDragging) currentSpeed *= 0.5; // Slower when dragging in water
    } else if (isCrouching) {
      currentSpeed = SPEED * 0.5; // Slower when crouching on land
      if (isDragging) currentSpeed *= 0.5;
    } else if (isDragging) {
      currentSpeed = SPEED * 0.4; // Much slower when dragging on land
    }

    if (moveDir.lengthSq() > 0) {
      // Normalize but keep magnitude if less than 1 (for joystick)
      const len = moveDir.length();
      if (len > 1) moveDir.normalize();
      
      // Rotate movement vector by camera angle
      const rotatedMoveDir = _rotatedMove.set(
        moveDir.x * Math.cos(cameraAngle) + moveDir.z * Math.sin(cameraAngle),
        0,
        -moveDir.x * Math.sin(cameraAngle) + moveDir.z * Math.cos(cameraAngle)
      );

      pos.x += rotatedMoveDir.x * currentSpeed * dt;
      pos.z += rotatedMoveDir.z * currentSpeed * dt;

      // Rotation
      const targetRotation = Math.atan2(rotatedMoveDir.x, rotatedMoveDir.z) + Math.PI;
      // Simple lerp for rotation
      const currentRotation = groupRef.current.rotation.y;
      // Handle wrap around
      let diff = targetRotation - currentRotation;
      while (diff < -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;
      
      // Anti-overshoot clamp for mobile lag spikes
      const rotationStep = diff * 10 * dt;
      const maxStep = Math.PI; // Don't snap more than 180 degrees in a single frame
      groupRef.current.rotation.y += Math.max(-maxStep, Math.min(maxStep, rotationStep));
    }

    // Jumping
    if (isJumping && isGrounded.current) {
      velocity.current.y = inWater ? JUMP_FORCE * 1.5 : JUMP_FORCE; // Dolphin hop
      isGrounded.current = false;
      if (inWater) {
        const now = Date.now();
        if (now - lastWeeTime.current > 1000) {
          soundEngine.playWee();
          lastWeeTime.current = now;
        }
      }
    }

    // Apply gravity
    velocity.current.y -= GRAVITY * dt;

    // Ground collision
    let groundY = terrainHeight + 0.5; // 0.5 is half beaver height
    
    // Check placed blocks — O(1) spatial hash lookup
    const nearbyBlocksForGround = getBlocksNear(blockHash, pos.x, pos.z);
    for (const block of nearbyBlocksForGround) {
      // Simple AABB check
      if (Math.abs(pos.x - block.position[0]) < 1.0 && Math.abs(pos.z - block.position[2]) < 1.0) {
        const blockTopY = block.position[1] + (block.type === 'mud' ? 0.25 : 0.4);
        groundY = Math.max(groundY, blockTopY + 0.5);
      }
    }

    // Check downed logs
    for (const log of useGameStore.getState().draggableLogs) {
      if (log.isDragged) continue; // Don't stand on the log you're dragging
      
      const [lx, ly, lz] = log.position;
      const [rx, ry, rz] = log.rotation;
      
      // If the log is mostly horizontal
      if (rx > Math.PI / 4) {
        // Log direction vector
        const dirX = Math.sin(rx) * Math.sin(ry);
        const dirY = Math.cos(rx);
        const dirZ = Math.sin(rx) * Math.cos(ry);
        
        // Vector from log center to player (ignoring Y for projection to find closest point on XZ plane)
        // Actually, better to project in 3D, but beaver moves in XZ.
        // Let's find the point on the log's center line that has the same XZ as the player.
        // Line: P(t) = Center + t * Dir
        // We want to find distance from player (pos.x, pos.z) to the line in XZ plane.
        
        const dx = pos.x - lx;
        const dz = pos.z - lz;
        
        // Project player position onto log direction in XZ plane
        // Normalize XZ direction
        const lenXZ = Math.sqrt(dirX * dirX + dirZ * dirZ);
        if (lenXZ > 0.001) {
          const nx = dirX / lenXZ;
          const nz = dirZ / lenXZ;
          
          const t = dx * nx + dz * nz;
          
          // Check if player is within the length of the log
          // Log cylinder is from -5.6 to 5.6
          // Leaves are from -2.1 to 11.9
          // We don't have direct access to leavesScales here, but we know:
          const hasLeaves = !log.isMudded;
          const maxT = hasLeaves ? 11.9 : 5.6;
          
          const actualT = t / lenXZ;
          
          if (actualT > -5.6 && actualT < maxT) {
            // Closest point on the center line in XZ
            const closestX = lx + nx * t;
            const closestZ = lz + nz * t;
            
            const distSq = (pos.x - closestX) ** 2 + (pos.z - closestZ) ** 2;
            
            // Calculate radius at this actualT
            let radius = 1.4;
            if (actualT <= 5.6) {
              // Cylinder tapers from 1.68 (bottom, -5.6) to 1.12 (top, 5.6)
              const tNorm = (actualT + 5.6) / 11.2;
              radius = 1.68 * (1 - tNorm) + 1.12 * tNorm;
            } else {
              radius = 0;
            }
            
            if (hasLeaves && actualT > -2.1) {
              // Leaves cone tapers to 0 at 11.9
              // Let's use a slightly wider base for the leaves so it feels structural
              const tNorm = (actualT - (-2.1)) / (11.9 - (-2.1));
              const leafRadius = 2.0 * (1 - tNorm);
              radius = Math.max(radius, leafRadius);
            }
            
            if (distSq < radius * radius) {
              // Player is above the log
              // Calculate height of the log's center line at this point
              const centerY = ly + dirY * actualT;
              
              // Calculate height of the log surface at this point
              const logTopY = centerY + Math.sqrt(radius * radius - distSq);
              groundY = Math.max(groundY, logTopY + 0.5);
            }
          }
        }
        
        // Check branches — ONLY for logs within 20 units (distance gate)
        const logDistSq = (pos.x - lx) ** 2 + (pos.z - lz) ** 2;
        if (logDistSq > 400) continue; // Skip branch checks for far-away logs
        
        _logPosScratch.set(lx, ly, lz);
        _logEulerScratch.set(rx, ry, rz);
        _logQuatScratch.setFromEuler(_logEulerScratch);
        _logScaleScratch.set(1, 1, 1);
        _logMatrix.compose(_logPosScratch, _logQuatScratch, _logScaleScratch);
        
        for (let bi = 0; bi < BRANCH_CONFIGS.length; bi++) {
          const config = BRANCH_CONFIGS[bi];
          _bPos.set(...config.pos);
          _bQuat.set(config.quat[0], config.quat[1], config.quat[2], config.quat[3]);
          _bScale.set(...config.scale);
          _branchMatrix.compose(_bPos, _bQuat, _bScale);
          _branchMatrix.premultiply(_logMatrix);
          
          _branchMatrix.decompose(_bPos, _bQuat, _bScale);
          
          _bDir.set(0, 1, 0).applyQuaternion(_bQuat);
          
          const bDx = pos.x - _bPos.x;
          const bDz = pos.z - _bPos.z;
          
          const bLenXZ = Math.sqrt(_bDir.x * _bDir.x + _bDir.z * _bDir.z);
          if (bLenXZ > 0.001) {
            const bNx = _bDir.x / bLenXZ;
            const bNz = _bDir.z / bLenXZ;
            
            const bT = bDx * bNx + bDz * bNz;
            const bActualT = bT / bLenXZ;
            
            if (bActualT > -2.1 && bActualT < 2.1) {
              const bClosestX = _bPos.x + bNx * bT;
              const bClosestZ = _bPos.z + bNz * bT;
              
              const bDistSq = (pos.x - bClosestX) ** 2 + (pos.z - bClosestZ) ** 2;
              const bRadius = 0.4 * config.scale[0];
              
              if (bDistSq < bRadius * bRadius) {
                const bCenterY = _bPos.y + _bDir.y * bActualT;
                const bTopY = bCenterY + Math.sqrt(bRadius * bRadius - bDistSq);
                groundY = Math.max(groundY, bTopY + 0.5);
              }
            }
          }
        }
      }
    }

    const waterHeight = waterEngine.getSurfaceHeight(pos.x, pos.z);
    let targetY = groundY;
    let isUnderwater = false;

    if (waterHeight > groundY - 0.5) {
       // Apply water flow velocity
       const vel = waterEngine.getVelocity(pos.x, pos.z);
       pos.x += vel.x * dt * 15;
       pos.z += vel.z * dt * 15;
       
       const waterSpeedSq = vel.x * vel.x + vel.z * vel.z;
       if (waterSpeedSq > 0.2) {
         const now = Date.now();
         if (now - lastWeeTime.current > 2000) {
           soundEngine.playWee();
           lastWeeTime.current = now;
         }
       }

       if (isCrouching) {
         // Dive underwater
         targetY = Math.max(groundY, waterHeight - 1.5);
         isUnderwater = true;
       } else {
         // Float slightly submerged
         targetY = Math.max(groundY, waterHeight + 0.1); 
       }
    }

    if (inWater) {
      if (pos.y < targetY) {
        // Buoyancy pushes up (counteracts gravity)
        velocity.current.y += (GRAVITY + (targetY - pos.y) * 15) * dt;
        // Dampen velocity
        velocity.current.y *= 0.9;
        isGrounded.current = true; // Allow jumping while in water
      } else {
        isGrounded.current = false;
      }
      
      pos.y += velocity.current.y * dt;
      
      // Prevent going below ground
      if (pos.y < groundY) {
        pos.y = groundY;
        if (velocity.current.y < 0) velocity.current.y = 0;
      }
    } else {
      pos.y += velocity.current.y * dt;
      
      if (pos.y <= groundY) {
        pos.y = groundY;
        velocity.current.y = 0;
        isGrounded.current = true;
      } else {
        isGrounded.current = false;
      }
    }

    // Update store
    setPlayerPosition([pos.x, pos.y, pos.z]);
    setPlayerRotation(groupRef.current.rotation.y);

    // Animate gather/place
    const { lastAction } = useGameStore.getState();
    const timeSinceAction = (Date.now() - lastAction.time) / 1000;
    
    // Reset rotations
    bodyRef.current.rotation.set(0, 0, 0);
    headRef.current.rotation.set(0, 0, 0);
    tailRef.current.rotation.set(-0.2, 0, 0);
    armLRef.current.rotation.set(0, 0, 0);
    armRRef.current.rotation.set(0, 0, 0);

    if (timeSinceAction < 0.6) {
      const progress = timeSinceAction / 0.6;
      
      if (lastAction.type === 'gather' && lastAction.blockType === 'stick') {
        // Gnaw tree
        headRef.current.rotation.x = Math.sin(progress * Math.PI * 10) * 0.3;
        bodyRef.current.rotation.x = Math.sin(progress * Math.PI * 20) * 0.05;
      } else if (lastAction.type === 'place' && lastAction.blockType === 'stick') {
        // Deploy log: lug over shoulder
        if (progress < 0.5) {
          // Lift up and back
          bodyRef.current.rotation.x = -Math.sin(progress * Math.PI) * 0.4;
          armLRef.current.rotation.x = -Math.PI * 0.8 * (progress * 2);
          armRRef.current.rotation.x = -Math.PI * 0.8 * (progress * 2);
        } else {
          // Throw forward
          const throwProgress = (progress - 0.5) * 2;
          bodyRef.current.rotation.x = Math.sin(throwProgress * Math.PI) * 0.3;
          armLRef.current.rotation.x = -Math.PI * 0.8 + (Math.PI * 1.2 * throwProgress);
          armRRef.current.rotation.x = -Math.PI * 0.8 + (Math.PI * 1.2 * throwProgress);
        }
      } else if (lastAction.type === 'place' && lastAction.blockType === 'mud') {
        // Pat mud with tail
        tailRef.current.rotation.x = -0.2 + Math.sin(progress * Math.PI * 8) * 0.6;
      } else if (lastAction.type === 'gather' && lastAction.blockType === 'mud') {
        // Dig mud
        bodyRef.current.rotation.x = 0.3 + Math.sin(progress * Math.PI * 6) * 0.2;
        armLRef.current.rotation.x = Math.sin(progress * Math.PI * 12) * 0.5;
        armRRef.current.rotation.x = Math.cos(progress * Math.PI * 12) * 0.5;
      }
    } else if (moveDir.lengthSq() > 0 || inWater) {
      // Walk/Swim animation
      const speedMult = inWater ? 15 : 10;
      const t = state.clock.elapsedTime * speedMult;
      
      if (inWater) {
        // Rich 3D swimming animation
        // Body roll based on movement
        bodyRef.current.rotation.z = Math.sin(t) * 0.15;
        headRef.current.rotation.z = -Math.sin(t) * 0.1;
        
        // Tail wags up and down, and side to side
        tailRef.current.rotation.y = Math.sin(t * 1.5) * 0.4;
        tailRef.current.rotation.x = -0.2 + Math.cos(t * 1.5) * 0.2;
        
        // Arms paddle
        armLRef.current.rotation.x = Math.sin(t) * 0.8;
        armRRef.current.rotation.x = Math.sin(t + Math.PI) * 0.8;
        
        // Pitch based on vertical movement (diving/jumping)
        if (velocity.current.y > 2) {
           // Jumping out of water
           bodyRef.current.rotation.x = Math.min(velocity.current.y * 0.1, Math.PI / 4);
           tailRef.current.rotation.x = 0.2; // Tail down
        } else if (velocity.current.y < -2 && inWater) {
           // Diving down rapidly
           bodyRef.current.rotation.x = -Math.PI / 4;
           tailRef.current.rotation.x = -0.8; // Tail high up in the air
        } else if (isUnderwater && moveDir.lengthSq() > 0) {
           // Swimming underwater
           bodyRef.current.rotation.x = -Math.PI / 8;
           tailRef.current.rotation.x = -0.4 + Math.cos(t * 1.5) * 0.2;
        } else {
           // Surface swimming or floating underwater
           bodyRef.current.rotation.x = Math.sin(t * 0.5) * 0.05;
        }
      } else {
        // Land walking
        bodyRef.current.rotation.z = Math.sin(t) * 0.1;
        headRef.current.rotation.z = -Math.sin(t) * 0.1;
        tailRef.current.rotation.y = Math.sin(t) * 0.3;
        armLRef.current.rotation.x = Math.sin(t) * 0.5;
        armRRef.current.rotation.x = -Math.sin(t) * 0.5;
      }
    }

    // Camera follow
    const distance = 15;
    const cameraOffset = _cameraOffset.set(
      Math.sin(cameraAngle) * Math.cos(cameraPitch) * distance,
      Math.sin(cameraPitch) * distance,
      Math.cos(cameraAngle) * Math.cos(cameraPitch) * distance
    );
    const targetCameraPos = _targetCameraPos.copy(pos).add(cameraOffset);
    
    // 1. Minimum height clamp for target offset
    const targetGroundHeight = getTerrainHeight(targetCameraPos.x, targetCameraPos.z);
    targetCameraPos.y = Math.max(targetCameraPos.y, targetGroundHeight + 1.5);
    
    // Anti-overshoot clamp for camera
    const lerpFactor = Math.min(1.0, 5 * delta);
    camera.position.lerp(targetCameraPos, lerpFactor);
    
    // 2. Minimum height clamp during active lerp transit (skating over ridges)
    const currentGroundHeight = getTerrainHeight(camera.position.x, camera.position.z);
    if (camera.position.y < currentGroundHeight + 1.0) {
      camera.position.y = currentGroundHeight + 1.0;
    }
    
    camera.lookAt(pos);
  });

  return (
    <group ref={groupRef} position={[0, 5, 0]}>
      <group ref={bodyRef}>
        {/* Body */}
        <mesh castShadow position={[0, 0, 0]}>
          <boxGeometry args={[1.2, 1.1, 1.6]} />
          <meshStandardMaterial color="#8B4513" />
        </mesh>
        
        {/* Head Group */}
        <group ref={headRef} position={[0, 0.6, -0.8]}>
          {/* Head Base */}
          <mesh castShadow position={[0, 0, 0]}>
            <boxGeometry args={[0.9, 0.9, 0.9]} />
            <meshStandardMaterial color="#A0522D" />
          </mesh>
          {/* Ears */}
          <mesh castShadow position={[-0.4, 0.45, 0]}>
            <sphereGeometry args={[0.2, 8, 8]} />
            <meshStandardMaterial color="#5C4033" />
          </mesh>
          <mesh castShadow position={[0.4, 0.45, 0]}>
            <sphereGeometry args={[0.2, 8, 8]} />
            <meshStandardMaterial color="#5C4033" />
          </mesh>
          {/* Eyes */}
          <mesh castShadow position={[-0.25, 0.2, -0.45]}>
            <sphereGeometry args={[0.08, 8, 8]} />
            <meshStandardMaterial color="#000000" />
          </mesh>
          <mesh castShadow position={[0.25, 0.2, -0.45]}>
            <sphereGeometry args={[0.08, 8, 8]} />
            <meshStandardMaterial color="#000000" />
          </mesh>
          {/* Snout/Nose */}
          <mesh castShadow position={[0, 0, -0.5]}>
            <boxGeometry args={[0.4, 0.3, 0.2]} />
            <meshStandardMaterial color="#3E2723" />
          </mesh>
          {/* Teeth */}
          <mesh castShadow position={[-0.08, -0.2, -0.55]}>
            <boxGeometry args={[0.12, 0.25, 0.05]} />
            <meshStandardMaterial color="#FFFFFF" />
          </mesh>
          <mesh castShadow position={[0.08, -0.2, -0.55]}>
            <boxGeometry args={[0.12, 0.25, 0.05]} />
            <meshStandardMaterial color="#FFFFFF" />
          </mesh>
        </group>

        {/* Arms */}
        <group ref={armLRef} position={[-0.65, -0.1, -0.5]}>
          <mesh castShadow position={[0, -0.2, 0]}>
            <boxGeometry args={[0.2, 0.5, 0.2]} />
            <meshStandardMaterial color="#5C4033" />
          </mesh>
        </group>
        <group ref={armRRef} position={[0.65, -0.1, -0.5]}>
          <mesh castShadow position={[0, -0.2, 0]}>
            <boxGeometry args={[0.2, 0.5, 0.2]} />
            <meshStandardMaterial color="#5C4033" />
          </mesh>
        </group>

        {/* Tail Group */}
        <group ref={tailRef} position={[0, -0.3, 0.8]} rotation={[-0.2, 0, 0]}>
          <mesh castShadow position={[0, 0, 0.6]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 1, 0.15]}>
            <cylinderGeometry args={[0.5, 0.5, 1.2, 16]} />
            <meshStandardMaterial color="#2F4F4F" />
          </mesh>
        </group>
      </group>
    </group>
  );
}
