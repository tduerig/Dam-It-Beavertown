---
description: Automated Play-Test and QA Evaluation of NPC Beaver AI
---

# /npc_playtest
This workflow launches a VLM Subagent to evaluate the autonomous NPC Beaver AI prototype in the WebGL build.

## QA Playtester Instructions
Launch `browser_subagent` configured to test the Beavertown local dev server at `http://localhost:8081`. 

Run the subagent with the exact following prompt:
"""
You are an expert Tool & AI Evaluator. Your goal is to test the Beavertown global Autopilot (Beaver NPC AI).

**Step 1: Environment Setup & Activation**
1. Find the DOM button labeled "PLAY NOW" or click visually on the Start screen to enter the game.
2. Once in the game, open the Chrome DevTools console natively or use Javascript to activate the autopilot directly if you cannot find the UI button (there is a Bot icon in the HUD):
```javascript
window.gameStore.getState().setAutopilot(true);
window.gameStore.getState().setSetting('showStatsOverlay', true);
```
3. Take a screenshot confirming the game is running and Autopilot is active.

**Step 2: Observation & Monitoring**
The beaver AI should now be moving automatically using state machine logic without any further input from you. It should seek trees, chop them, collect logs, and deposit them into the fast river current to build a dam.
You must WAIT and visually observe the AI for at least 30-45 seconds of simulation time. 
*Do NOT press any movement or action keys.*

Use Javascript to observe its progress:
```javascript
JSON.stringify(window.gameStore.getState().stats)
```

**Step 3: Verification & Reporting**
Wait until the `stats` indicate that trees have been downed and mud has been patted. The AI should also eventually eat snacks.
After a sufficient observation period, take a final screenshot. Look critically at the screenshot to observe where the logs are being placed. Are they near the river? 

Construct a JSON Payload representing your QA findings:
```json
{
  "stats": { ...extracted stats... },
  "status": "NPC Evaluation Complete",
  "ai_milestones": [
     "Did the AI successfully chop a tree?",
     "Did the AI drag a log?",
     "Did the AI reach the water?"
  ],
  "qa_report": {
     "visual_pathing": "Describe how the beaver moved. Was it jittery? Stuck?",
     "dam_construction": "Did it successfully drop logs into the running water?",
     "overall_rating": "Your critical evaluation of this prototype AI."
  }
}
```
Return exactly this JSON as your final output.
"""

Mandatory: Append this result to `playtests/npc_eval_index.html` where we track all AI evaluations.
