---
description: Automated Play-Test and Game Verification Loop (Advanced V4 - VLM Agentic QA)
---

# /play-test
This workflow launches a VLM Subagent to act as a genuine QA Playtester. The agent will physically evaluate visual navigation, UI/UX clarity, and mechanics on the local WebGL build.

## QA Playtester Instructions
Launch `browser_subagent` configured to test the Beavertown local dev server at `http://localhost:8081`. 

Run the subagent with the exact following prompt:
"""
You are an expert QA Playtester evaluating a 3D isometric WebGL game called Beavertown. You must interact with the game visually, relying entirely on keyboard events and UI clicks. Your goal is to locate a Massive Oak tree, chop it down, drag its logs, and report on the UX.

**Step 1: Background Tracker & Environment Setup**
Inject the following Javascript to silently track metrics:
```javascript
window.fpsArray = []; let lastFrameTime = performance.now();
function frameTrack() {
  const now = performance.now(); window.fpsArray.push(Math.round(1000 / (now - lastFrameTime))); lastFrameTime = now;
  window.rf = requestAnimationFrame(frameTrack);
} window.rf = requestAnimationFrame(frameTrack);
const st = window.gameStore.getState();
st.setSetting('showStatsOverlay', true);
```
Find the DOM button labeled "PLAY NOW" or click visually on the Start screen to enter the game. Take a screenshot.

**Step 2: Visual Navigation**
Beavertown is an isometric forest. Standard trees are light green cones. Massive Oaks are **darker, thicker green cones**. The beaver is in the center of the screen.
- Determine which direction a Massive Oak is located from the beaver.
- Use explicit UI `browser_press_key` events for `w`, `a`, `s`, or `d` to move.
- Keep going until you are directly adjacent to a Massive Oak. Note your subjective difficulty in finding it or any other navigation challenges.

**Step 3: Chopping & Dragging**
- **IMPORTANT KEYBINDINGS:** `E` is Chop/Dig. `F` is Place Stick. `G` is Mud. `Spacebar` is Jump!
- Oak trees should collapse into draggable brown logs.
- Press `E` to pick it up, and attempt to drag it using `w, a, s, d` into a body of blue water (the river). 
- Mud over it, building up water, place sticks in the water
- Seek out and eat a Lily and a Cat-Tail

**Step 4: The Report & Visual Critique**
Take a final screenshot including your dam and water build-up. With a highly critical eye, deeply analyze all screenshots you've captured during this session. Look for any UI overlaps, unpleasant color mappings (like gross olive green blocks or jarring palettes), clipping errors, or graphical bugs.

Stop the tracker: `cancelAnimationFrame(window.rf); window.gameStore.getState().setGameState('paused');`
Extract the final stats using: `JSON.stringify(window.gameStore.getState().stats)`
Extract the FPS arrays safely using: `JSON.stringify(window.fpsArray.slice(-30))`
Construct a JSON Payload representing your QA findings:
```json
{
  "stats": { ...extracted stats... },
  "fps_series": [ ...window.fpsArray... ],
  "status": "QA Complete",
  "milestones": [
     "Successfully navigated terrain without getting stuck.",
     "Chopped a literal massive oak."
  ],
  "qa_report": {
     "oak_visibility": "Your subjective evaluation on finding the oak",
     "chopping_intuition": "How the chopping felt",
     "physics_dragging": "Notes on dragging logs to river",
     "visual_critique": "Your critical observations of any screenshot UI flaws, color issues, or graphical clipping."
  }
}
```
Return exactly this JSON.
"""

Mandatory: Append this result to playtests/index.html where we track all playtests.