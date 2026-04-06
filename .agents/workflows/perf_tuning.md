---
description: Performance Optimization & Benchmarking Framework
---
# /perf-tuning

A comprehensive performance benchmarking and optimization workflow for Dam It! Beavertown.

## Prerequisites

Before starting, read the performance skill:
```
view_file .agents/skills/perf_tuning/SKILL.md
```

## The Loop

### Step 1: Run Hermetic Benchmarks
```bash
npm test -- --testPathPattern=benchmarks --verbose
```
Parse the JSON output from each test. Flag any test consuming >50% of the 16.6ms frame budget.

### Step 2: Capture Baseline Metrics
Save the benchmark JSON output to `benchmarks/YYYY-MM-DD-HH:MM.json` as a regression baseline.

### Step 3: Agentic Live Playtest
Run `/play_test` with the PerfOverlay enabled. The playtest agent should:
1. Enable stats overlay: `window.gameStore.getState().setSetting('showStatsOverlay', true)`
2. Play through the standard QA scenario
3. Execute the stress scenario: chop 3 massive oaks, drag logs to river, place mud
4. Capture FPS data throughout
5. Report P50/P95/P99 frame times

### Step 4: Analyze Hot Paths
Using the Skill's Anti-Pattern Taxonomy (AP-1 through AP-6), scan `src/components/` for:
- Per-frame `new THREE.*` allocations (AP-1: GC Storm)
- Multiple Zustand `set()` calls per frame (AP-2: Shallow Copy Cascade)
- Unconditional `instanceMatrix.needsUpdate = true` (AP-3: Dirty Flag Neglect)
- `computeVertexNormals()` on large meshes per frame (AP-4: Normal Tax)

### Step 5: Apply Fixes
Follow the Optimization Playbook in priority order (object pooling → batch mutations → dirty flags → ...).

### Step 6: Verify
Re-run Steps 1-3. Compare against baseline:
- Benchmark regression > 10% = investigation required
- FPS P95 must remain ≤ 16.6ms
- No sustained drops below 30 FPS under stress

### Step 7: Report
**CRITICAL:** Output a structured performance report by appending a new HTML `<div class="card">` block to `playtests/index.html` using the `multi_replace_file_content` tool. The card must contain:
- Before/after benchmark comparison
- FPS histogram / dataset
- Hot path analysis
- Applied optimizations
- Quality tier configuration used
Ensure you physically copy any generated charts/recordings into the `playtests/` directory via `run_command` so they can be parsed by `index.html`.

## Core Rules of Engagement

1. **Verify Baseline First**: Always capture metrics *before* making changes.
2. **Big-O Decimation First**: Never optimize React renders before confirming the active physics array processing loop is O(1) spatial hashed or strictly grid-bounded.
3. **Never Degrade Gameplay**: Per `.agents/instructions.md`, never alter gameplay features for performance. Find mathematical optimizations instead.
4. **Use Quality Tiers**: Route all fidelity decisions through `src/utils/qualityTier.ts`, never hardcode `Platform.OS` checks.
5. **Stagger Ticking**: Fluid dynamics or massive array sweeps must run on decoupled intervals, never inside `useFrame`.
