const fs = require('fs');
const path = require('path');

const run = () => {
    const playtestsDir = path.join(__dirname);
    const files = fs.readdirSync(playtestsDir).filter(f => f.endsWith('.json'));

    let htmlCards = '';

    files.forEach(file => {
        const raw = fs.readFileSync(path.join(playtestsDir, file), 'utf-8');
        try {
            const data = JSON.parse(raw);
            const title = file.replace('.json', '');
            
            // Limit chart arrays
            const cleanArray = (data.fps_series || []).map(num => num > 100 ? 60 : num); // Clamp wildly high FPS spikes caused by inactive tab loops

            htmlCards += `
            <div class="card">
                <h2 class="header">Benchmark: ${title} <span style="font-size: 14px; float: right;">Water Coverage: ${data.stats?.maxWaterCoverage || 0}%</span></h2>
                <div class="grid">
                    <div>
                        <h3>Telemetry Snapshot</h3>
                        ${data.milestones && data.milestones.length > 0 ? `
                        <div style="margin-bottom: 12px; padding: 12px; background: rgba(16, 185, 129, 0.1); border-left: 3px solid #10b981; border-radius: 4px;">
                            <h4 style="margin: 0 0 8px 0; color: #34d399;">🌟 Playtest Milestones</h4>
                            <ul style="margin: 0; padding-left: 20px; color: #a7f3d0; font-size: 14px;">
                                ${data.milestones.map(m => `<li>${m}</li>`).join('')}
                            </ul>
                        </div>
                        ` : ''}
                        <pre>
Mud Dug: ${data.stats?.mudDug || 0}
Mud Patted: ${data.stats?.mudPatted || 0}
Sticks Placed: ${data.stats?.sticksPlaced || 0}
Trees Downed: ${data.stats?.treesDowned || 0}
Massive Oaks Felled: ${data.stats?.massiveTreesFelled || 0}
                        </pre>
                        
                        ${data.qa_report ? `
                        <h3>Agentic Discovery Notes</h3>
                        <div style="background: rgba(0,0,0,0.3); padding: 10px; border-left: 3px solid #f59e0b; font-size: 14px;">
                            <p><strong style="color: #fbbf24;">Oak Visibility:</strong> ${data.qa_report.oak_visibility}</p>
                            <p><strong style="color: #fbbf24;">Chopping Intuition:</strong> ${data.qa_report.chopping_intuition}</p>
                            <p><strong style="color: #fbbf24;">Physics Dragging:</strong> ${data.qa_report.physics_dragging}</p>
                        </div>
                        ` : ''}
                        
                        <h3>Framerate Time-Series</h3>
                        <canvas id="chart_${title.replace(/[^a-zA-Z0-9]/g, '_')}" width="400" height="200"></canvas>
                        <script>
                            document.addEventListener('DOMContentLoaded', function() {
                                const ctx = document.getElementById('chart_${title.replace(/[^a-zA-Z0-9]/g, '_')}').getContext('2d');
                                new Chart(ctx, {
                                    type: 'line',
                                    data: {
                                        labels: Array.from({length: ${cleanArray.length}}, (_, i) => i),
                                        datasets: [{
                                            label: 'FPS',
                                            data: ${JSON.stringify(cleanArray)},
                                            borderColor: '#38bdf8',
                                            backgroundColor: 'rgba(56, 189, 248, 0.1)',
                                            tension: 0.3,
                                            fill: true
                                        }]
                                    },
                                    options: { 
                                        responsive: true,
                                        scales: {
                                            y: { min: 0, max: 70 }
                                        }
                                    }
                                });
                            });
                        </script>
                    </div>
                    <div>
                        <h3>Engine Capture</h3>
                        ${data.recordingRef ? `<img class="media" src="./${data.recordingRef}" alt="Recording" />` : ''}
                        ${data.screenshotRef ? `<img class="media" src="./${data.screenshotRef}" alt="Ref" />` : ''}
                    </div>
                </div>
            </div>`;
        } catch(e) {
            console.error("Invalid JSON:", file);
        }
    });

    const indexHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Magic Game-Dev Journal</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <style>
        body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; padding: 2rem; max-width: 1200px; margin: auto; }
        .card { background: #1e293b; border-radius: 12px; padding: 24px; margin-bottom: 24px; border: 1px solid #334155; }
        .header { margin-bottom: 1rem; border-bottom: 1px solid #334155; padding-bottom: 0.5rem; color: #38bdf8; }
        .media { max-width: 100%; border-radius: 8px; margin-top: 1rem; border: 1px solid #475569; }
        pre { background: #000; padding: 1rem; border-radius: 6px; overflow-x: auto; color: #4ade80; font-size: 15px;}
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 2rem; }
        @media (max-width: 768px) { .grid { grid-template-columns: 1fr; } }
    </style>
</head>
<body>
    <h1>Beavertown Performance Archive</h1>
    <p style="color: #94a3b8; margin-bottom: 2rem;">Automated telemetry validations tracking real-world game bounds processing and engine capacity.</p>
    ${htmlCards}
</body>
</html>
    `;

    fs.writeFileSync(path.join(playtestsDir, 'index.html'), indexHtml);
    console.log("Dashboard Rebuilt successfully.");
};

run();
