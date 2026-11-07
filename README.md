# Dam It! Beavertown 🦫🌊

An eco-physics 3D sandbox and ecosystem simulation game built with **React Three Fiber**, **Three.js**, and **Expo** (Web, iOS, and Android).

Play as an industrious beaver shaping a procedural river valley: fell trees, drag and stack logs to engineer dams, flood basins to create thriving wetlands, build lodges, and coexist with autonomous wildlife (otters, bears, moose, eagles, and rival beaver colonies).

---

## Key Features

- **Hydrological & Eco-Physics Simulation**: Dynamic cellular water simulation where log dams impound river flow, raise upstream water tables, and transform arid banks into lush wetland biomes.
- **Tactile Log Engineering**: Chop timber, haul buoyant logs through currents, and stack or mud-cement structures that physically alter river hydrology.
- **Living Ecosystem & Autonomous Wildlife**:
  - **Beaver Colonies & Kits**: Build lodges, store winter food caches, and raise kits.
  - **World-Sim NPCs**: Autonomous otters, bears, moose, and birds that forage, hunt, and respond to your ecological footprint.
- **Cross-Platform Performance**: Universal Expo Router architecture running on Web (WebGL) and Native iOS/Android (`expo-gl`), featuring consolidated instanced flora rendering, dynamic terrain LOD scaling, GPU tier auto-tuning, and a native WebGL `DataTexture` minimap.

---

## Running Locally

**Prerequisites:** Node.js (v18+)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the development server:**
   - **Web (Browser):**
     ```bash
     npm run web
     ```
   - **Universal Expo CLI (QR code for Expo Go / iOS / Android):**
     ```bash
     npm start
     ```
   - **iOS Simulator / Android Emulator:**
     ```bash
     npm run ios
     # or
     npm run android
     ```

---

## Mobile & Cloud Builds (EAS)

The project is configured for **Expo Application Services (EAS)**:

- **Build Android internal preview APK:** `npm run build:android:apk`
- **Build Production iOS / Android:** `npm run build:ios` / `npm run build:android`
- **Submit to TestFlight / Google Play:** `npm run submit:ios` / `npm run submit:android`

---

## Developer Guides & Test Suites

The game relies heavily on automated and visual testing for physical interactions, frame-rate profiling, and biome balance:

- **Ecology Simulator (`index.html` journal)**: Found in `/simtests/index.html`. Benchmarks `beaver-sim` water bounds, cellular flow, and ecosystem resource balance across multi-scenario runs.
- **Agentic Playtests (`index.html` journal)**: Found in `/playtests/index.html`. Automated frame-rate logging and visual validation suite for major gameplay systems.
- **Agentic Workflows & Skills**: Look in `.agents/skills` (`sim_journaling`, `world_sim_npcs`, `perf_tuning`, `mobile_deploy`) for formalized protocols on running benchmarks, tuning R3F performance, and deploying builds.
