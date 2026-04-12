# Unify Dam Physics and Stacking Mechanics

The Beaver A/B testing simulator showed that the AI physically builds the structure, but the resulting water coverage (15%) is completely identical to the Control world! This implies the dam is entirely porous and physically dysfunctional within the WaterEngine. 

## Issue Analysis
1. **Integer Floor Gaps**: The Beaver AI builds its dam iteratively by evaluating target spots spaced by 1.5 coordinate units (`x += 1.5`). However, `WaterEngine` applies mud chunks exactly to a 1x1 coordinate pixel using `Math.floor()`. A 1.5 spacing guarantees that pixels aren't contiguous (e.g. `Math.floor(1.5) = 1`, `Math.floor(3.0) = 3`, pixel 2 is entirely missing!). Water flows directly through these mathematically impassible 1-unit micro-gaps.
2. **Lack of Stacking Z-Resolution**: In `npcActions.ts`, blocks (mud/sticks) are instantiated directly at the default underlying `terrainHeight` without any accumulation. Because `WaterEngine` takes `block.y + 0.25` for mud altitude, a beaver continually patching mud on the same coordinate fundamentally replaces it at the same exact altitude instead of gradually stacking the barrier organically.

## Proposed Changes

### 1. `src/utils/WaterEngine.ts`
- **Expand Mud & Stick Collision Radius**: Elevate the `mud` generation envelope from a singular pixel `(cx, cz)` to cover a `3x3` matrix or circular radius (dist < 1.2). This natively mimics the visual "pat" diameter of the 3D mud models in-game and physically seals the 1.5 coordinate step-distance gaps.

### 2. `src/utils/npcActions.ts`
- **Develop Y-Axis Stacking Accumulation**: Re-map the `target.y` origin allocation inside `placeMud` and `placeStick` to actively query the current physical `placedBlocks` array for dense accumulations. If an existing `mud`, `stick` or `log` block has altitude immediately adjacent to the coordinate, the new Y-value will spawn logically on top instead of fusing back into the bedrock.

## User Action Required
> [!IMPORTANT]  
> Are these physics sealing / stacking parameters aligned with how you want the game mechanics to function?

## Verification Plan
After tweaking the footprint matrix and Y-axis stacking logic, we will trigger the 14x headless simulator loop using the browser subagent. The expected result is a measurable deviation between Control Coverage and Beaver Dam Coverage on the telemetry readout.
