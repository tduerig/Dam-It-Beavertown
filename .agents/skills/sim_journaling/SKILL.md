---
name: Eco-Physics Simulation Journaling
description: A formalized process for modifying environmental rules, running multi-scenario simulator benchmarks, and journaling structural results to the HTML testing suite.
---

# Sim-Test Journaling Protocol

This skill dictates the exact workflow for testing ecological balance and water physics modifications in the `beaver-sim world-tests` environment and rigorously journaling the results.

## 1. Modify the Simulation
When instructed to tweak ecological spawn rates, physics constants, or terrain configurations, apply the changes exactly as requested in `app/water-test.tsx`.
Common modifications include:
- Tweak flow parameters (`isCalmWater = speed < X`)
- Edit vegetation yield ratios (`Math.random() < Y`)
- Add a new `TestScenario` array item to the `SCENARIOS` constant.

## 2. Trigger Fast Refresh
Before running any benchmark browser agents, you MUST ensure the server has ingested the changes:
```bash
# Touch the file to trigger Metro Fast Refresh
touch app/water-test.tsx
```

## 3. Run the Subagent Benchmark
Use the `browser_subagent` to formally run the benchmark. The simulation **requires real-time JS loop propagation**, so the subagent MUST:
1. Navigate explicitly to `http://localhost:8081/water-test`
2. Wait a rigidly defined interval (usually **120 seconds**) to allow the biome to grow.
3. Capture a screenshot locally named `ecology_[modification]_[duration]`.
4. Read and extract the numerical statistics rendered below the `<canvas>` components.

## 4. Copy the Artifact Media
The artifact screenshot is stored deep in the `.gemini/antigravity/` log. Copy the screenshot into the project `<root>/simtests` folder so it can be served via relative paths in HTML.
```bash
# Example syntax
cp /Users/tomduerig/.gemini/.../ecology_mytest_120s_xxx.png ./simtests/mytest_120s.png
```

## 5. Append to the Journal
**CRITICAL:** YOU (the main agent) MUST explicitly edit the journal using the `multi_replace_file_content` tool. 
The journal is located at `simtests/index.html`. Append a new `<div class="card">` inside the body block detailing:
- The telemetry bounds for the relevant scenarios (e.g., Baseline vs Full River Dam vs Felled Log).
- The Agentic Discovery Notes objectively summarizing the impact (e.g. "Rarity Balance", "Water Spillage").
- The copied `.png` media artifact representing the final 120s frame using relative `src=` paths.
