#!/usr/bin/env python3
"""
Beavertown World-Sim Journal Builder
Reads all experiment runs from simtests/runs/*.json and generates
a multi-experiment dashboard at simtests/index.html with Chart.js.

Usage: python3 scripts/build_journal.py
"""
import json, os, glob, sys

RUNS_DIR = 'simtests/runs'
OUTPUT = 'simtests/index.html'

if not os.path.isdir(RUNS_DIR):
    print(f"No runs directory at {RUNS_DIR}. Run a benchmark first!")
    sys.exit(1)

run_files = sorted(glob.glob(os.path.join(RUNS_DIR, '*.json')))
if not run_files:
    print("No experiment JSON files found in simtests/runs/")
    sys.exit(1)

experiments = []
for rf in run_files:
    with open(rf) as f:
        data = json.load(f)
    basename = os.path.splitext(os.path.basename(rf))[0]
    capture_path = rf.replace('.json', '.webp')
    data['_id'] = basename
    data['_has_capture'] = os.path.exists(capture_path)
    data['_capture_file'] = f"runs/{basename}.webp" if data['_has_capture'] else None
    experiments.append(data)

print(f"Found {len(experiments)} experiment(s)")

# --- Build HTML ---
def make_experiment_card(exp, idx):
    """Generate one experiment card with charts + stats."""
    eid = exp['_id']
    meta = exp.get('experiment', {})
    name = meta.get('name', eid)
    desc = meta.get('description', '')
    changes = meta.get('changes', [])
    ts = meta.get('timestamp', '?')
    
    beaver = exp.get('timeseries', {}).get('npc_beaver', [])
    control = exp.get('timeseries', {}).get('control', [])
    ai = exp.get('aiBehaviorStats', {})
    stats = exp.get('stats', {})
    
    labels = [f"Min {i+1}" for i in range(len(beaver))]
    bVol = [d.get('coverage', 0) for d in beaver]
    cVol = [d.get('coverage', 0) for d in control]
    bLilies = [d.get('lilies', 0) for d in beaver]
    cLilies = [d.get('lilies', 0) for d in control]
    bCattails = [d.get('cattails', 0) for d in beaver]
    cCattails = [d.get('cattails', 0) for d in control]
    bTrees = [d.get('trees', 0) for d in beaver]
    cTrees = [d.get('trees', 0) for d in control]
    
    aiLabels = list(ai.keys())
    aiData = [str(round(ai[k] / 1000.0, 1)) for k in aiLabels]
    
    # Deltas
    dWater = bVol[-1] - cVol[-1] if bVol and cVol else 0
    dLilies = bLilies[-1] - cLilies[-1] if bLilies and cLilies else 0
    dCattails = bCattails[-1] - cCattails[-1] if bCattails and cCattails else 0
    dTrees = bTrees[-1] - cTrees[-1] if bTrees and cTrees else 0
    
    def delta_class(v):
        return 'delta-pos' if v > 0 else 'delta-neg' if v < 0 else 'delta-zero'
    def delta_str(v):
        return f"+{v}" if v > 0 else str(v)
    
    changes_html = ''.join(f'<li>{c}</li>' for c in changes)
    
    capture_html = ""
    if exp.get('_has_capture'):
        capture_html = f'''
        <div class="capture-box">
            <img src="{exp['_capture_file']}" class="capture" alt="Simulation recording" />
        </div>'''
    
    return f'''
    <div class="experiment" id="exp-{eid}">
        <div class="exp-header">
            <div class="exp-number">#{idx+1}</div>
            <div>
                <h2>{name}</h2>
                <p class="exp-desc">{desc}</p>
                <p class="exp-ts">{ts}</p>
            </div>
        </div>
        
        {"<div class='changes'><h3>Changes</h3><ul>" + changes_html + "</ul></div>" if changes else ""}
        
        <div class="delta-bar">
            <div class="delta-item">
                <span class="delta-label">Water</span>
                <span class="{delta_class(dWater)}">{delta_str(dWater)} m³</span>
            </div>
            <div class="delta-item">
                <span class="delta-label">Lilies</span>
                <span class="{delta_class(dLilies)}">{delta_str(dLilies)}</span>
            </div>
            <div class="delta-item">
                <span class="delta-label">Cattails</span>
                <span class="{delta_class(dCattails)}">{delta_str(dCattails)}</span>
            </div>
            <div class="delta-item">
                <span class="delta-label">Trees</span>
                <span class="{delta_class(dTrees)}">{delta_str(dTrees)}</span>
            </div>
        </div>
        
        <div class="chart-grid">
            <div class="chart-card">
                <h3>Water Volume (m³)</h3>
                <div class="chart-box"><canvas id="water_{eid}"></canvas></div>
            </div>
            <div class="chart-card">
                <h3>Tree Population</h3>
                <div class="chart-box"><canvas id="trees_{eid}"></canvas></div>
            </div>
            <div class="chart-card">
                <h3>Lilies</h3>
                <div class="chart-box"><canvas id="lilies_{eid}"></canvas></div>
            </div>
            <div class="chart-card">
                <h3>Cattails</h3>
                <div class="chart-box"><canvas id="cattails_{eid}"></canvas></div>
            </div>
        </div>
        
        <div class="bottom-row">
            <div class="chart-card pie-card">
                <h3>AI Time Allocation</h3>
                <div class="pie-box"><canvas id="pie_{eid}"></canvas></div>
            </div>
            <div class="stats-card">
                <h3>Game Stats</h3>
                <div class="stat-row"><span>Trees Felled</span><span class="stat-val">{stats.get("treesDowned","?")}</span></div>
                <div class="stat-row"><span>Massive Oaks</span><span class="stat-val">{stats.get("massiveTreesFelled","?")}</span></div>
                <div class="stat-row"><span>Mud Packed</span><span class="stat-val">{stats.get("mudPatted","?")}</span></div>
                <div class="stat-row"><span>Sticks Placed</span><span class="stat-val">{stats.get("sticksPlaced","?")}</span></div>
                <div class="stat-row"><span>Snacks Eaten</span><span class="stat-val">{stats.get("snacksEaten","?")}</span></div>
            </div>
        </div>
        
        {capture_html}
    </div>
    
    <script>
    (function() {{
        const L = {json.dumps(labels)};
        const opts = {{
            responsive: true, maintainAspectRatio: false,
            interaction: {{ mode: 'index', intersect: false }},
            plugins: {{ legend: {{ labels: {{ color: '#e2e8f0', font: {{ family: 'Inter', size: 11 }} }} }} }},
            scales: {{
                x: {{ ticks: {{ color: '#64748b', maxTicksLimit: 10 }}, grid: {{ color: 'rgba(51,65,85,0.3)' }} }},
                y: {{ ticks: {{ color: '#64748b' }}, grid: {{ color: 'rgba(51,65,85,0.3)' }} }}
            }}
        }};
        const mkLine = (id, bData, cData, bColor, label) => {{
            new Chart(document.getElementById(id), {{
                type: 'line', data: {{
                    labels: L,
                    datasets: [
                        {{ label: 'Beaver '+label, data: bData, borderColor: bColor, backgroundColor: bColor+'22', borderWidth: 2, tension: 0.3, fill: true, pointRadius: 1.5 }},
                        {{ label: 'Control '+label, data: cData, borderColor: '#64748b', borderDash: [4,4], borderWidth: 1.5, tension: 0.3, pointRadius: 0 }}
                    ]
                }}, options: opts
            }});
        }};
        mkLine('water_{eid}', {json.dumps(bVol)}, {json.dumps(cVol)}, '#0ea5e9', '(m³)');
        mkLine('trees_{eid}', {json.dumps(bTrees)}, {json.dumps(cTrees)}, '#22c55e', '');
        mkLine('lilies_{eid}', {json.dumps(bLilies)}, {json.dumps(cLilies)}, '#67e8f9', '');
        mkLine('cattails_{eid}', {json.dumps(bCattails)}, {json.dumps(cCattails)}, '#fde047', '');
        
        const aiColors = ['#f43f5e','#ec4899','#d946ef','#a855f7','#8b5cf6','#6366f1','#3b82f6','#0ea5e9','#06b6d4','#14b8a6','#10b981','#22c55e','#84cc16'];
        new Chart(document.getElementById('pie_{eid}'), {{
            type: 'doughnut', data: {{
                labels: {json.dumps(aiLabels)},
                datasets: [{{ data: {json.dumps(aiData)}, backgroundColor: aiColors.slice(0,{len(aiLabels)}), borderWidth: 2, borderColor: '#1e293b' }}]
            }},
            options: {{ responsive: true, maintainAspectRatio: false, plugins: {{ legend: {{ position: 'right', labels: {{ color: '#e2e8f0', font: {{ family: 'Inter', size: 10 }}, padding: 8 }} }} }} }}
        }});
    }})();
    </script>
    '''

cards_html = ""
for i, exp in enumerate(reversed(experiments)):  # newest first
    cards_html += make_experiment_card(exp, len(experiments) - 1 - i)

html = f'''<!DOCTYPE html>
<html lang="en">
<head>
    <title>Beavertown World-Sim Journal</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;600;700&display=swap" rel="stylesheet">
    <style>
        * {{ box-sizing: border-box; margin: 0; padding: 0; }}
        body {{ font-family: 'Inter', sans-serif; background: #0f172a; color: #f8fafc; padding: 30px; }}
        
        .hero {{ text-align: center; margin-bottom: 40px; padding: 30px; 
            background: linear-gradient(135deg, rgba(14,165,233,0.08), rgba(168,85,247,0.08));
            border-radius: 16px; border: 1px solid rgba(148,163,184,0.1); }}
        .hero h1 {{ color: #38bdf8; font-size: 2em; font-weight: 700; margin-bottom: 6px; }}
        .hero p {{ color: #94a3b8; }}
        .hero .run-count {{ color: #a78bfa; font-weight: 600; margin-top: 8px; }}
        
        .experiment {{ background: #1e293b; border-radius: 14px; padding: 28px; margin-bottom: 30px;
            border: 1px solid rgba(148,163,184,0.08); box-shadow: 0 4px 24px rgba(0,0,0,0.3); }}
        .exp-header {{ display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }}
        .exp-number {{ background: #0ea5e9; color: #fff; font-weight: 700; font-size: 1.2em;
            width: 42px; height: 42px; border-radius: 10px; display: flex; align-items: center;
            justify-content: center; flex-shrink: 0; }}
        .exp-header h2 {{ color: #f1f5f9; font-size: 1.3em; font-weight: 600; }}
        .exp-desc {{ color: #94a3b8; font-size: 0.9em; margin-top: 3px; }}
        .exp-ts {{ color: #475569; font-size: 0.8em; margin-top: 2px; }}
        
        .changes {{ background: rgba(15,23,42,0.5); border-radius: 8px; padding: 14px 18px; margin-bottom: 18px; }}
        .changes h3 {{ color: #94a3b8; font-size: 0.85em; font-weight: 600; margin-bottom: 8px; text-transform: uppercase; letter-spacing: 0.05em; }}
        .changes ul {{ list-style: none; }}
        .changes li {{ color: #cbd5e1; font-size: 0.85em; padding: 3px 0; padding-left: 16px; position: relative; }}
        .changes li::before {{ content: '→'; position: absolute; left: 0; color: #fbbf24; }}
        
        .delta-bar {{ display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }}
        .delta-item {{ background: rgba(15,23,42,0.6); padding: 10px 16px; border-radius: 8px; text-align: center; flex: 1; min-width: 100px; }}
        .delta-label {{ display: block; color: #94a3b8; font-size: 0.75em; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }}
        .delta-pos {{ color: #34d399; font-weight: 700; font-size: 1.2em; }}
        .delta-neg {{ color: #fb7185; font-weight: 700; font-size: 1.2em; }}
        .delta-zero {{ color: #94a3b8; font-weight: 700; font-size: 1.2em; }}
        
        .chart-grid {{ display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }}
        .chart-card {{ background: rgba(15,23,42,0.4); border-radius: 10px; padding: 16px; }}
        .chart-card h3 {{ color: #94a3b8; font-size: 0.85em; font-weight: 600; margin-bottom: 10px; }}
        .chart-box {{ position: relative; height: 220px; }}
        
        .bottom-row {{ display: flex; gap: 16px; margin-bottom: 16px; }}
        .pie-card {{ flex: 1; }}
        .pie-box {{ position: relative; height: 260px; }}
        .stats-card {{ background: rgba(15,23,42,0.4); border-radius: 10px; padding: 16px; min-width: 220px; }}
        .stats-card h3 {{ color: #94a3b8; font-size: 0.85em; font-weight: 600; margin-bottom: 12px; }}
        .stat-row {{ display: flex; justify-content: space-between; padding: 6px 0; border-bottom: 1px solid rgba(51,65,85,0.3); }}
        .stat-row span {{ color: #cbd5e1; font-size: 0.9em; }}
        .stat-val {{ color: #38bdf8; font-weight: 600; }}
        
        .capture-box {{ margin-top: 16px; text-align: center; }}
        .capture {{ max-width: 100%; border-radius: 8px; border: 1px solid #334155; }}
        
        .footer {{ color: #475569; font-size: 0.8em; text-align: center; margin-top: 30px; }}
    </style>
</head>
<body>
    <div class="hero">
        <h1>Beavertown World-Sim Journal</h1>
        <p>Headless A/B Ecosystem Benchmarks — Unified BeaverAI vs Pristine Control</p>
        <p class="run-count">{len(experiments)} experiment(s) recorded</p>
    </div>
    
    {cards_html}
    
    <div class="footer">Generated by scripts/build_journal.py from simtests/runs/</div>
</body>
</html>'''

with open(OUTPUT, 'w') as f:
    f.write(html)

print(f"Dashboard rendered to {OUTPUT}")
print(f"  {len(experiments)} experiments")
for e in experiments:
    name = e.get('experiment', {}).get('name', e['_id'])
    print(f"  - {e['_id']}: {name}")
