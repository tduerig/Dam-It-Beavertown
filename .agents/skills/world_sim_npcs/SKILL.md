---
name: "World-Sim NPCs (Pillar 3)"
description: A formalized process for benchmarking Otter AI ecological viability by comparing Flora & Water generation metrics against a pristine baseline river.
---

# World-Sim NPC Benchmarking Skill

This skill defines the **3rd Pillar** of Beavertown testing: headless A/B ecosystem simulation.
It runs the unified `BeaverAI` brain in a dual-engine sandbox (`npc-sim.web.tsx`) at 14.4× real-time, 
comparing an AI-inhabited world against a pristine control, then generates a rich Chart.js dashboard.

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│  app/npc-sim.web.tsx   (Headless React Sandbox)     │
│  ┌──────────────┐  ┌──────────────┐                 │
│  │  WaterEngine  │  │  WaterEngine  │  ← Dual grids │
│  │  (Beaver z=0) │  │ (Control z=2k)│                │
│  └──────┬───────┘  └──────┬───────┘                 │
│         │                  │                         │
│  ┌──────┴───────┐         │                         │
│  │  BeaverAI    │  (No AI)│                         │
│  │  (unified)   │         │                         │
│  └──────────────┘         │                         │
│         ↓ every 3600 ticks (1 virtual min)           │
│  ┌──────────────────────────────────────┐           │
│  │ Telemetry: volume, lilies, cattails, │           │
│  │ trees, AI state accumulator          │           │
│  └──────────────┬───────────────────────┘           │
│                 │ POST on completion                 │
│                 ↓                                    │
│  simtests/save_server.js → latest_data.json         │
│                          → runs/run_TIMESTAMP.json   │
└─────────────────────────────────────────────────────┘
         ↓ python3 scripts/build_journal.py
┌─────────────────────────────────────────────────────┐
│  simtests/index.html  (Multi-Experiment Dashboard)  │
│  For EACH archived experiment:                      │
│  • Delta bar (Beaver vs Control: ±water/lily/etc)   │
│  • Water Volume, Trees, Lilies, Cattails charts     │
│  • AI Temporal Allocation doughnut chart             │
│  • Game stat panel + embedded .webp recording       │
│  • Experiment metadata (name, description, changes) │
└─────────────────────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `app/npc-sim.web.tsx` | Headless dual-engine sandbox |
| `src/utils/BeaverAI.ts` | Unified AI brain (same as game) + `stateTimeAccumulator` |
| `src/utils/ecology.ts` | Flora spawn rules (shared with game) |
| `simtests/save_server.js` | Node.js telemetry receiver on :9999 (auto-archives to runs/) |
| `scripts/build_journal.py` | Multi-experiment Chart.js dashboard generator |
| `simtests/runs/` | **Archived experiment JSONs + recordings** |
| `simtests/latest_data.json` | Most recent raw telemetry output |
| `simtests/index.html` | Generated multi-experiment dashboard |

---

## Execution Workflow

### Step 1: Start the Save Server
```bash
// turbo
/opt/homebrew/bin/node simtests/save_server.js &
```
This binds to port `9999` and will catch the single POST from the sim when it completes.

### Step 2: Trigger Fast Refresh
Ensure Metro picks up any code changes:
```bash
// turbo
touch app/npc-sim.web.tsx
```

### Step 3: Run the Benchmark via Browser Subagent
Use the `browser_subagent` tool with recording name `npc_worldsim`:

**Subagent Prompt Template:**
```
Navigate to http://localhost:8081/npc-sim and wait for it to load.

You should see "NPC Sandbox: World Sim (Dual Engine)" with two side-by-side 
canvases (AI World left, Control World right) and a telemetry panel.

The status will progress from SIMULATING_MIN_0 through SIMULATING_MIN_19, 
then show SIMULATION_COMPLETE. Wait ~100s real time.

When you see SIMULATION_COMPLETE (or after 120s max), report:
1. Final status text
2. All telemetry values (Trees Felled, Mud, Water Volumes, Flora counts)
3. Whether both canvases show water (blue) and flora (colored dots)

Return SUCCESS with all values.
```

### Step 4: Archive the Experiment
After the subagent completes, you MUST archive the run with experiment metadata.
The save_server auto-saves to `simtests/runs/run_TIMESTAMP.json`, but you should
rename it with a descriptive prefix and add experiment metadata:

```python
# Run this inline to add metadata to the auto-archived run
python3 -c "
import json, glob, os, shutil
# Find the most recent auto-archived run
runs = sorted(glob.glob('simtests/runs/run_*.json'))
if not runs: exit('No runs found')
latest = runs[-1]
with open(latest) as f: d = json.load(f)
# Add experiment metadata — EDIT THESE for each run!
d['experiment'] = {
    'name': 'YOUR_EXPERIMENT_NAME',
    'description': 'What you changed and why',
    'changes': ['file.ts: specific change 1', 'file.ts: specific change 2'],
    'timestamp': '$(date -Iseconds)'
}
# Rename with descriptive prefix (e.g., 003_my_experiment)
new_name = 'simtests/runs/NNN_descriptive_name.json'
with open(new_name, 'w') as f: json.dump(d, f, indent=2)
os.remove(latest)
print(f'Archived as {new_name}')
"
```

Also copy the subagent's `.webp` recording with the SAME basename:
```bash
cp <artifact_path>/npc_worldsim_*.webp simtests/runs/NNN_descriptive_name.webp
```

### Step 5: Generate the Journal Dashboard
```bash
// turbo
python3 scripts/build_journal.py
```
This reads ALL experiments from `simtests/runs/*.json` and generates a cumulative
multi-experiment dashboard at `simtests/index.html`. Each experiment shows as a card
with delta bars, 4 line charts, an AI pie chart, stats, and the embedded recording.
**Newest experiments appear first.**

### Step 6: Preview the Dashboard
Use the `browser_subagent` to open `simtests/index.html` and verify all experiment
cards render with their charts. Confirm before/after comparisons are visible.

---

## Tuning Guide

### Ecology Parameters (in `src/utils/ecology.ts`)
These parameters control flora spawning and directly affect the A/B comparison:

| Parameter | Current | Effect |
|-----------|---------|--------|
| Lily depth threshold | `depth >= 0.2` | Min water depth for lily spawn |
| Lily speed threshold | `speed < 1.5` | Max flow velocity (calm water) |
| Lily spawn rate | `0.08 * greenZoneFalloff` | Base probability per ray |
| Lily chunk cap | `8` | Max lilies per 40×40 chunk |
| Cattail depth range | `0.01 < depth < 0.2` | Shallow water band |
| Cattail spawn rate | `0.20 * greenZoneFalloff` | Base probability per ray |
| Cattail chunk cap | `6` | Max cattails per chunk |
| Tree light radius | `4` tiles | Min distance between trees |
| sapling→small rate | `0.6` (60%) | Per ecology tick |
| small→big rate | `0.05` (5%) | Per ecology tick |

### Water Physics (in `src/utils/terrainConfig.ts`)
| Parameter | Current | Effect |
|-----------|---------|--------|
| `riverDepth` | `3` | Default channel depth |
| `twistAmplitude` | `15` | S-curve intensity |
| `slope` | `0.1` | Downstream gravity |

### Sim Config (in `app/npc-sim.web.tsx`)
| Parameter | Current | Effect |
|-----------|---------|--------|
| `TARGET_STEPS` | `72000` | 20 virtual minutes at 60 FPS |
| `TICK_SIZE` | `15` | Physics frames per UI frame (speed multiplier) |
| Ecology interval | `18000` steps | Flora regen every 5 virtual minutes |
| Initial flora | `200` per world | Starting ecosystem richness |
| Big oak ratio | `35%` | Initial big tree probability |

### NPC-Sim Override (in `app/npc-sim.web.tsx` line ~45)
The sim injects these terrain overrides specifically for the benchmark:
```typescript
updateTerrainConfig({ riverDepth: 4, slope: 0.025 });
```
Remove or adjust these to test different river configurations.

---

## Important Notes

### Control World Ecology
`propagateForest()` uses `playerPosition` (near z=0), so it ONLY reaches the beaver world.
The control world (z=2000) has a **manual ecology pass** in npc-sim.web.tsx that mirrors
the same rules. When tuning ecology.ts, you MUST also update the matching control-world
rules in npc-sim.web.tsx (search for "Manual ecology for Control world").

### Tree Growth Dynamics  
Felling trees **clears light-exclusion zones**, allowing saplings to spawn in the gaps.
With a 60% sapling→small promotion rate per tick, beaver worlds will always have MORE
total trees than control worlds. This is ecologically correct — beaver activity creates
forest clearings that promote biodiversity.

### The simulate() Trap
`WaterEngine.simulate(bandStart?, bandEnd?)` takes optional ROW BAND parameters.
NEVER pass dt or step counters as arguments — call `simulate()` with no args for full grid.
