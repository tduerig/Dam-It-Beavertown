const fs = require('fs');

if (!fs.existsSync('simtests/latest_data.json')) {
    console.error('No empirical telemetry exists. Run the benchmark first!');
    process.exit(1);
}

const rawDump = fs.readFileSync('simtests/latest_data.json', 'utf8');
const obj = JSON.parse(rawDump);

const beaverData = obj.timeseries['npc_beaver'] || [];
const controlData = obj.timeseries['control'] || [];
const aiStats = obj.aiBehaviorStats || {};

// Format AI States for Pie Chart
const aiLabels = Object.keys(aiStats);
// Convert milliseconds to seconds!
const aiData = aiLabels.map(k => (aiStats[k] / 1000).toFixed(1));

// Extract labels for X-Axis (Virtual Minutes)
const simLabels = beaverData.map((_, i) => `Min ${i + 1}`);

// Gather tracking lines
const bVol = beaverData.map(d => d.coverage);
const cVol = controlData.map(d => d.coverage);
const bLilies = beaverData.map(d => d.lilies);
const cLilies = controlData.map(d => d.lilies);
const bCattails = beaverData.map(d => d.cattails);
const cCattails = controlData.map(d => d.cattails);

const htmlTemplate = `
<!DOCTYPE html>
<html>
<head>
    <title>Beavertown AI & Physics Sim Journal</title>
    <meta charset="utf-8">
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 40px; }
        .hero { text-align: center; margin-bottom: 40px; }
        h1 { color: #38bdf8; }
        h2 { color: #94a3b8; font-weight: 300; border-bottom: 1px solid #1e293b; padding-bottom: 10px;}
        .dashboard { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; margin-bottom: 40px; }
        .card { background: #1e293b; padding: 20px; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); }
        .pie-card { grid-column: span 2; display: flex; align-items: center; justify-content: space-around; }
        .chart-container { position: relative; width: 100%; height: 300px; }
        .pie-container { position: relative; width: 400px; height: 400px; }
        .media-board { margin-top: 40px; background: #1e293b; padding: 20px; border-radius: 12px;}
        .capture { width: 100%; border-radius: 8px; border: 2px solid #334155; }
    </style>
</head>
<body>
    <div class="hero">
        <h1>Ecological Impact Journal</h1>
        <p>Simulation Baseline vs Unified True-AI Beaver Matrix 14x Benchmarks</p>
    </div>

    <div class="dashboard">
        <div class="card">
            <h2>Water Retention Profile (Volume m³)</h2>
            <div class="chart-container"><canvas id="waterChart"></canvas></div>
        </div>
        <div class="card">
            <h2>Flora Disruption Tracking</h2>
            <div class="chart-container"><canvas id="floraChart"></canvas></div>
        </div>
        
        <div class="card pie-card">
            <div style="flex: 1;">
                <h2>AI Temporal Allocation (Active Chronological Seconds)</h2>
                <p style="color:#94a3b8; line-height: 1.6;">How exactly did the Beaver prioritize its 20 virtual minutes of existence?</p>
                <div style="margin-top: 20px;">
                    <div style="font-size:24px; color:#34d399; font-weight:bold;">\u03A3 Trees Felled: \${obj.stats ? obj.stats.treesDowned : '?'}</div>
                    <div style="font-size:24px; color:#fbbf24; font-weight:bold;">\u03A3 Mud Footprints: \${obj.stats ? obj.stats.mudPatted : '?'}</div>
                </div>
            </div>
            <div class="pie-container"><canvas id="aiPie"></canvas></div>
        </div>
    </div>

    <script>
        // Water Chart
        new Chart(document.getElementById('waterChart'), {
            type: 'line',
            data: {
                labels: ${JSON.stringify(simLabels)},
                datasets: [
                    { label: 'Beaver Dam Flow (m³)', data: ${JSON.stringify(bVol)}, borderColor: '#0ea5e9', backgroundColor: 'rgba(14, 165, 233, 0.2)', borderWidth: 3, tension: 0.3, fill: true },
                    { label: 'Control Flow (m³)', data: ${JSON.stringify(cVol)}, borderColor: '#94a3b8', borderDash: [5, 5], borderWidth: 2, tension: 0.3 }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: false } }, plugins: { legend: { labels: { color: '#f8fafc' } } } }
        });

        // Flora Chart
        new Chart(document.getElementById('floraChart'), {
            type: 'line',
            data: {
                labels: ${JSON.stringify(simLabels)},
                datasets: [
                    { label: 'Beaver Lilies', data: ${JSON.stringify(bLilies)}, borderColor: '#86efac', tension: 0.2 },
                    { label: 'Control Lilies', data: ${JSON.stringify(cLilies)}, borderColor: '#22c55e', borderDash: [2, 2] },
                    { label: 'Beaver Cattails', data: ${JSON.stringify(bCattails)}, borderColor: '#fde047', tension: 0.2 },
                    { label: 'Control Cattails', data: ${JSON.stringify(cCattails)}, borderColor: '#a16207', borderDash: [2, 2] }
                ]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { labels: { color: '#e2e8f0' } } } }
        });

        // AI Pie Chart
        const rawAiColors = ['#f43f5e', '#ec4899', '#d946ef', '#a855f7', '#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9', '#06b6d4', '#14b8a6', '#10b981', '#22c55e', '#84cc16'];
        new Chart(document.getElementById('aiPie'), {
            type: 'doughnut',
            data: {
                labels: ${JSON.stringify(aiLabels)},
                datasets: [{
                    data: ${JSON.stringify(aiData)},
                    backgroundColor: rawAiColors,
                    borderWidth: 2,
                    borderColor: '#1e293b'
                }]
            },
            options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: '#f8fafc' } } } }
        });
    </script>
</body>
</html>
`;

fs.writeFileSync('simtests/index.html', htmlTemplate);
console.log('Successfully rendered simtests/index.html dashboard!');
