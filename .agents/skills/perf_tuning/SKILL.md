---
name: Performance Tuning for R3F/Expo Games
description: Comprehensive measurement practices, anti-pattern taxonomy, and optimization playbook for React Three Fiber games on Expo (web + native).
---

# Performance Tuning Skill

This skill provides the holistic framework for diagnosing, measuring, and optimizing performance in React Three Fiber (R3F) games running on Expo across web, iOS, and Android.

## The Frame Budget

The target is **60 FPS = 16.6ms per frame**. Every millisecond matters.

A frame in an R3F/Expo game is consumed by these layers, from bottom to top:

| Layer | Budget Share | What It Covers |
|-------|-------------|----------------|
| **Simulation** | ~2-4ms | Physics ticks, water engine, terrain math, collision detection |
| **Bridging** | ~0.5-1ms | Zustand state reads, Object3D matrix composition for InstancedMesh |
| **React** | ~1-3ms | Component re-renders, reconciliation, hook evaluations |
| **WebGL** | ~8-12ms | Draw calls, shadow maps, vertex processing, fragment shading |

> [!IMPORTANT]
> On mobile (especially pre-A13 iPads, mid-range Snapdragon), the WebGL layer alone can consume 12ms+. This means JS must stay under **4ms total** to avoid frame drops.

---

## Measurement Toolkit

### 1. Hermetic V8 Benchmarks
Test pure computation cost in isolation, without WebGL overhead. Run via Jest:
```bash
npm test -- --testPathPattern=benchmarks
```
**When to use**: Validate that math-heavy loops (terrain, water, collision) fit within budget bounds. These are regression gates — run before and after any optimization.

**Pattern**:
```typescript
it('Bounds: [description]', () => {
  const start = performance.now();
  // ... hot loop ...
  const cost = performance.now() - start;
  console.log(JSON.stringify({
    test: 'test_name',
    totalMs: +cost.toFixed(2),
    budgetPct: +(cost / 16.6 * 100).toFixed(1),
    pass: cost < THRESHOLD
  }));
  expect(cost).toBeLessThan(THRESHOLD);
});
```

### 2. Live `useFrame` Instrumentation
Bracket the hot path inside any `useFrame` hook:
```typescript
useFrame(() => {
  const t0 = performance.now();
  // ... frame work ...
  const cost = performance.now() - t0;
  if (cost > 4) console.warn(`[PERF] ${componentName}: ${cost.toFixed(1)}ms`);
});
```

### 3. WebGL Renderer Stats
Access Three.js renderer info from within any R3F component:
```typescript
const { gl } = useThree();
// After each frame:
gl.info.render.calls;      // Draw calls this frame
gl.info.render.triangles;  // Triangles rendered
gl.info.memory.geometries; // Cached geometries
gl.info.memory.textures;   // Cached textures
```

### 4. JS Heap Monitoring (Web Only)
```typescript
if (performance.memory) {
  const mb = performance.memory.usedJSHeapSize / 1048576;
  // > 200MB is a yellow flag, > 400MB is a red flag for mobile web
}
```

### 5. User Timing API
For tracking async or staggered operations:
```typescript
performance.mark('water-tick-start');
waterEngine.update(...);
performance.mark('water-tick-end');
performance.measure('water-tick', 'water-tick-start', 'water-tick-end');
```

### 6. Agentic Browser Instrumentation
When running `/play_test`, inject FPS tracking via the browser subagent:
```javascript
window.fpsArray = []; let lastFrameTime = performance.now();
function frameTrack() {
  const now = performance.now();
  window.fpsArray.push(Math.round(1000 / (now - lastFrameTime)));
  lastFrameTime = now;
  window.rf = requestAnimationFrame(frameTrack);
}
window.rf = requestAnimationFrame(frameTrack);
```

---

## Anti-Pattern Taxonomy

### AP-1: The GC Storm (Per-Frame Allocation)
**Symptom**: Sporadic microstutters (every 1-5 seconds), GC spikes in Chrome DevTools.
**Cause**: Creating `new THREE.Vector3()`, `new THREE.Matrix4()`, `new THREE.Object3D()` etc. inside `useFrame` callbacks.
**Fix**: Hoist all scratch objects to module scope and reuse them:
```typescript
// BAD — inside useFrame
const moveDir = new THREE.Vector3();
const target = new THREE.Vector3();

// GOOD — module scope
const _moveDir = new THREE.Vector3();
const _target = new THREE.Vector3();
useFrame(() => {
  _moveDir.set(0, 0, 0);
  // ...
});
```

### AP-2: The Shallow Copy Cascade (Zustand State Spread)
**Symptom**: Frame drops proportional to state object size.
**Cause**: Calling Zustand `set()` in a hot loop, where each call does `{ ...state.largeObject }`.
**Fix**: Batch mutations. Accumulate changes locally during the frame, then dispatch once:
```typescript
// BAD — N dispatches per frame
for (const item of items) {
  store.getState().modifyTerrain(x, z, 0.1, 1.5);
}

// GOOD — 1 dispatch per frame
const batch = [];
for (const item of items) {
  batch.push({ x, z, amount: 0.1, radius: 1.5 });
}
store.getState().batchModifyTerrain(batch);
```

### AP-3: Dirty Flag Neglect (Unconditional GPU Uploads)
**Symptom**: Constant GPU overhead even when nothing visually changed.
**Cause**: Setting `instanceMatrix.needsUpdate = true` every frame regardless of whether any instance actually moved.
**Fix**: Track a `needsInstanceUpdate` flag, only set `needsUpdate` when at least one instance changed state.

### AP-4: The Normal Tax (Expensive Vertex Normals)
**Symptom**: 2-3ms per frame consumed by a single function call.
**Cause**: `geometry.computeVertexNormals()` on large meshes (e.g. 160×160 water grid = 25,600 vertices) every frame.
**Fix**: Either compute analytical normals inline during the vertex update loop, skip frames, or gate behind quality tier.

### AP-5: Hidden Subscriptions (Zustand in Render)
**Symptom**: Entire component tree re-renders when unrelated state changes.
**Cause**: Using `useGameStore(state => state)` or reading state inside render without a selector.
**Fix**: Use precise selectors: `useGameStore(state => state.specificField)`. For `useFrame`, use `useGameStore.getState()` to avoid subscriptions entirely.

### AP-6: Timer Accumulation (Unguarded setInterval)
**Symptom**: CPU usage climbs over time. Multiple intervals fighting for the same resource.
**Cause**: `setInterval` inside `useEffect` without proper cleanup, or re-entrant callbacks.
**Fix**: Always return cleanup. Use a guard flag: `if (isUpdating) return; isUpdating = true; ... isUpdating = false;`

---

## Optimization Playbook (Impact Order)

### 1. Object Pooling
**Impact**: HIGH — eliminates the #1 source of GC pressure on mobile.
Pre-allocate all Three.js math objects (Vector3, Matrix4, Object3D, Quaternion, Euler) at module scope. Never `new` inside `useFrame`.

### 2. Batch Zustand Mutations
**Impact**: HIGH — eliminates O(n) shallow copies per frame for terrain/block changes.
Accumulate all changes during a frame tick, dispatch once via a dedicated batch action.

### 3. Dirty-Flag InstanceMatrix Updates
**Impact**: MEDIUM — saves GPU upload bandwidth when entities are static.
Track whether any instance actually changed in the current frame. Only set `needsUpdate = true` when the dirty flag is set.

### 4. Staggered Physics Ticking
**Impact**: MEDIUM — prevents simulation cost from blocking render.
Run physics (water engine, ecology) on a `setInterval` decoupled from `requestAnimationFrame`. Already implemented in this codebase via WaterRenderer.

### 5. Spatial Hashing for Collision
**Impact**: MEDIUM — converts O(n) entity scans to O(1) lookups.
Use a `Map<string, entity>` keyed by grid cell for block/tree/log collision checks. Already partially implemented (blockHash in DraggableLogs).

### 6. Distance-Gated Processing
**Impact**: MEDIUM — skip expensive calculations for far-away entities.
Before iterating branch configs, log physics, etc., check `distanceSq > threshold`. Cheaper than doing the full math.

### 7. Shadow Map Discretization
**Impact**: LOW-MEDIUM — reduces shadow map re-renders.
Only update shadow maps when the light position meaningfully changes (e.g. hourly game-time). Already implemented in LightingSystem.

### 8. Analytical Normals
**Impact**: LOW-MEDIUM — replaces expensive generic `computeVertexNormals()`.
When updating water vertex positions, compute normals from neighbor height differences in the same loop. ~10× cheaper than the generic Three.js implementation.

### 9. Resolution Tuning
**Impact**: LOW — reduces CPU cost of ancillary systems.
Minimap resolution (100→60→40px), update frequency (250ms→500ms), rain particle count. All governed by quality tiers.

---

## Quality Tier System

This codebase uses a **per-aspect** quality system with three axes:
- **Simulation**: `low | medium | high` — water grid size, physics substeps
- **Graphics**: `low | medium | high` — shadows, water material, environment map
- **Rendering**: `low | medium | high` — rain, view distance, vertex normals, minimap

Configuration lives in `src/utils/qualityTier.ts`. Components read cached configs via `getSimConfig()`, `getGraphicsConfig()`, `getRenderConfig()`.

**When optimizing**: Never hardcode `Platform.OS` checks for fidelity decisions. Always route through the quality tier system.

---

## Benchmarking Protocol

### Before Making Changes
1. Run `npm test -- --testPathPattern=benchmarks`
2. Save the output JSON as a baseline: `benchmarks/YYYY-MM-DD-HH:MM.json`
3. Run `/play_test` to capture live FPS baseline

### After Making Changes
1. Re-run benchmarks
2. Compare against baseline — flag any regression > 10%
3. Re-run `/play_test` — compare FPS P50/P95/P99
4. Document results in the playtest output

### Stress Scenarios
Define reproducible worst-case loads for benchmarking:
1. **Oak Storm**: Chop 3 massive oaks simultaneously → 3 falling logs + leaf dissolution
2. **Flood**: Maximum rain for 30 seconds → water grid maxed, 100% coverage
3. **Dam Build**: 20+ sticks + 10 mud blocks placed → max terrain offset churn
4. **Exploration**: Walk to edge of map → max chunk loading, 49 chunks active

---

## Diagnostic Checklist

When investigating a performance issue, work through these in order:

1. **Is it JS or GPU?** Check frame time vs draw call count. If draw calls are low but frame time is high → JS bottleneck. If draw calls are high → GPU bottleneck.
2. **Is it allocation?** Check for GC spikes in Chrome DevTools timeline. Look for `new THREE.*` in `useFrame` callbacks.
3. **Is it Zustand?** Add `console.log` in Zustand `set()` callbacks. Count dispatches per frame. More than 1-2 per frame is suspicious.
4. **Is it a specific component?** Add `performance.now()` brackets to each `useFrame`. The one consuming >4ms is the culprit.
5. **Is it conditional?** Does it only lag during specific actions (tree chopping, rain, etc.)? Reproduce the specific scenario and measure.
