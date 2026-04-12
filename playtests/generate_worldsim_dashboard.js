const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = 9999;
const playtestsDir = __dirname;
const outputHtml = path.join(playtestsDir, 'worldsim_eval_index.html');

const server = http.createServer((req, res) => {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk.toString());
        req.on('end', () => {
            try {
                const payload = JSON.parse(body);
                console.log(`Received payload: ${payload.status}`);
                generateDashboard(payload);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ success: true }));
                console.log("Shutting down telemetry listener.");
                process.exit(0); // Exit after generating the dashboard
            } catch (e) {
                console.error(e);
                res.writeHead(400);
                res.end('Invalid Payload');
            }
        });
    } else {
        res.writeHead(404);
        res.end();
    }
});

const generateDashboard = (data) => {
    // Chart generation logic here!
    const beaverSeries = data.timeseries.npc_beaver || [];
    const controlSeries = data.timeseries.control || [];
    
    const beaverCoverage = beaverSeries.map(s => s.coverage);
    const controlCoverage = controlSeries.map(s => s.coverage);
    
    const beaverLilies = beaverSeries.map(s => s.lilies);
    const controlLilies = controlSeries.map(s => s.lilies);

    const beaverCattails = beaverSeries.map(s => s.cattails);
    const controlCattails = controlSeries.map(s => s.cattails);

    const labels = Array.from({length: beaverSeries.length}, (_, i) => i);
    
    const htmlCards = `
        <div class="card">
            <h2 class="header">World-Sim Ecological Benchmark <span style="font-size: 14px; float: right;">Date: ${new Date().toLocaleString()}</span></h2>
            
            <div class="grid">
                <div>
                    <h3>Otter AI Impact (Z=0)</h3>
                    <pre>
Trees Downed: ${data.stats.treesDowned}
Massive Oaks Felled: ${data.stats.massiveTreesFelled}
Mud Patted: ${data.stats.mudPatted}
Flora Snacks Eaten: ${data.stats.snacksEaten}
                    </pre>
                </div>
            </div>

            <div class="grid" style="margin-top: 24px;">
                <!-- Water Coverage -->
                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px;">
                    <h3 style="color: #60a5fa; margin-top: 0;">Dam Water Coverage (%)</h3>
                    <canvas id="chart_coverage" width="400" height="200"></canvas>
                </div>
                
                <!-- Flora Biomass -->
                <div style="background: rgba(0,0,0,0.3); padding: 16px; border-radius: 8px;">
                    <h3 style="color: #4ade80; margin-top: 0;">Flora (Lilies & Cattails) Count</h3>
                    <canvas id="chart_flora" width="400" height="200"></canvas>
                </div>
            </div>

            <script>
                document.addEventListener('DOMContentLoaded', function() {
                    const ctx1 = document.getElementById('chart_coverage').getContext('2d');
                    new Chart(ctx1, {
                        type: 'line',
                        data: {
                            labels: ${JSON.stringify(labels)},
                            datasets: [
                                {
                                    label: 'Beaver Dam Coverage (%)',
                                    data: ${JSON.stringify(beaverCoverage)},
                                    borderColor: '#3b82f6',
                                    backgroundColor: 'rgba(59, 130, 246, 0.2)',
                                    fill: true,
                                    tension: 0.3
                                },
                                {
                                    label: 'Control Baseline (%)',
                                    data: ${JSON.stringify(controlCoverage)},
                                    borderColor: '#94a3b8',
                                    backgroundColor: 'transparent',
                                    borderDash: [5, 5],
                                    fill: false,
                                    tension: 0.3
                                }
                            ]
                        },
                        options: { responsive: true, scales: { y: { min: 0 } } }
                    });

                    const ctx2 = document.getElementById('chart_flora').getContext('2d');
                    new Chart(ctx2, {
                        type: 'line',
                        data: {
                            labels: ${JSON.stringify(labels)},
                            datasets: [
                                {
                                    label: 'Beaver Flora Biomass',
                                    data: ${JSON.stringify(beaverLilies.map((v, i) => v + beaverCattails[i]))},
                                    borderColor: '#22c55e',
                                    backgroundColor: 'rgba(34, 197, 94, 0.2)',
                                    fill: true,
                                    tension: 0.3
                                },
                                {
                                    label: 'Control Flora Biomass',
                                    data: ${JSON.stringify(controlLilies.map((v, i) => v + controlCattails[i]))},
                                    borderColor: '#64748b',
                                    backgroundColor: 'transparent',
                                    borderDash: [5, 5],
                                    fill: false,
                                    tension: 0.3
                                }
                            ]
                        },
                        options: { responsive: true, scales: { y: { min: 0 } } }
                    });
                });
            </script>
        </div>
    `;

    const indexHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Ecological World-Sim Journal</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; max-width: 1300px; margin: auto; }
        .card { background: #1e293b; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #334155; }
        .header { margin-bottom: 1rem; border-bottom: 1px solid #334155; padding-bottom: 0.5rem; color: #38bdf8; }
        pre { background: #000; padding: 1rem; border-radius: 6px; overflow-x: auto; color: #4ade80; font-size: 15px;}
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
        @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <h1>Beavertown Ecological Automation</h1>
    <p style="color: #94a3b8; margin-bottom: 2rem;">A/B mapping of Artificial Beaver dams versus Natural River conditions.</p>
    ${htmlCards}
</body>
</html>
    `;

    fs.writeFileSync(outputHtml, indexHtml);
    console.log("Written worldsim_eval_index.html perfectly!");
}

server.listen(PORT, () => {
    console.log(`World-Sim Dashboard Server listening on Localhost:${PORT}`);
    console.log(`Waiting for NPC Sandbox Payload submission...`);
});
