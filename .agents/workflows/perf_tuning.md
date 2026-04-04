---
description: Performance Optimization & Benchmarking Framework
---
# /perf-tuning
A comprehensive benchmarking schema for ensuring mathematical grid structures and rendering pipelines maintain 60 FPS prior to merging.

## Core Rules of Engagement

1. **Verify Baseline with "play_test"**
Always run `/play-test` *before* attempting complex physics tuning, generating a `benchmarks/X.json` to prove the baseline state.
2. **Big-O Decimation First**
Never optimize React renders or variable lifecycles before confirming the active physics array processing loop is $O(1)$ spatial hashed or strictly grid-bounded. 
3. **Minimize Native Bridging**
In RN/ThreeFiber contexts, minimize bridging continuous state values to the DOM. Eject static arrays out of Zustand context limits immediately. 
4. **Use Staggered Ticking**
Fluid dynamics or massive array sweeps (like Water percentile checks) should occur on `setInterval` closures unlinked from WebGL `requestAnimationFrame` hooks to prevent lockup compounding.

## The Loop
When invoked to "do some perf tuning", first run the raw baseline automation, then interrogate `benchmarks/X.json`, analyze the most egregious processing loop from recent edits using `view_file` on `src/components`, and isolate the math out of the main thread. 
