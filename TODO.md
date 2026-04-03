# Dam It! Beavertown - Roadmap & TODO

## Performance & Engine

- [ ] **Parameterize Physics Reductions**: Create dynamic settings parameters (or automatic heuristics) for the native performance reductions. Currently hardcoded in:
  - `WaterEngine.ts`: `WATER_SIZE` (reduced from 160 to 80 natively)
  - `WaterRenderer.tsx`: Disable `computeVertexNormals()` natively
  - `RainRenderer.tsx`: `RAIN_COUNT` (reduced from 5000 to 1000 natively)
  *Goal*: Instead of a blanket `Platform.OS !== 'web'` check, these should be governed by a proper "Graphics/Physics Fidelity" store variable allowing players on high-end M-series iPads/Pro hardware to easily toggle "Ultra" settings natively while keeping the baseline perfectly safe for standard memory profiles.

## Multiplayer & Battle Mode

- [ ] **Supabase Multiplayer Sync**: Resume integration of the `.onUpdate` physics tick data streaming into Supabase Realtime for Battle mode.

## Code Health

- [ ] **TypeScript Typings**: Clean up Duplicate Identifier (`virtualCamera`) and incorrect property maps in `useGameStore` and `store.test.ts`.
- [ ] **Asset Management**: Abstract EXR skybox loading to prevent Three.js memory bloat if we decide to re-introduce higher-fidelity HDR shading natively later.
