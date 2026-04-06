import puppeteer from 'puppeteer';
import fs from 'fs';

(async () => {
    console.log("Launching headless browser...");
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    
    // Connect to CDP
    const client = await page.target().createCDPSession();
    
    console.log("Navigating to game...");
    await page.goto('http://localhost:8081', { waitUntil: 'load', timeout: 60000 });
    
    console.log("Waiting for world to build...");
    await page.waitForTimeout(5000); // 5s for chunk generation + initial bloom

    // Click Play Now
    await page.mouse.click(500, 800);
    await page.waitForTimeout(2000);

    console.log("Extracting Flora Data...");
    // Inject a quick check to see if InstancedMeshes exist and what their bounds are
    const floraData = await page.evaluate(() => {
       const results = [];
       // The RTF canvas has the state
       const canvas = document.querySelector('canvas');
       if (canvas) {
           // We can access the internal React root via keys, but let's just use window.__THREE__ if we exposed it,
           // Or just check DOM for errors / lags
       }
       return document.body.innerHTML.substring(0, 500); // Just check if loaded
    });
    console.log("DOM Snippet:", floraData.replace(/\n/g, ' '));
    
    console.log("Starting CPU Profiler...");
    await client.send('Profiler.enable');
    await client.send('Profiler.start');

    // Simulate intense camera spinning (A and D keys) to force bounds checks
    for (let i = 0; i < 20; i++) {
        await page.keyboard.press('a');
        await page.waitForTimeout(100);
    }
    
    const { profile } = await client.send('Profiler.stop');
    
    fs.writeFileSync('cpu_profile.json', JSON.stringify(profile));
    console.log("CPU Profile saved to cpu_profile.json");
    
    await browser.close();
    
    // Quick summarize the profile
    let maxTime = 0;
    let heaviestFunc = "";
    
    const nodes = profile.nodes;
    const hitCounts = new Map();
    // V8 profiles use timeDeltas or hit counts
    if (profile.samples) {
        for (const sampleId of profile.samples) {
            hitCounts.set(sampleId, (hitCounts.get(sampleId) || 0) + 1);
        }
    }
    
    const sorted = [...hitCounts.entries()].sort((a,b) => b[1] - a[1]);
    console.log("\nTop CPU Consumers (by sample hit count):");
    for (let i=0; i<Math.min(10, sorted.length); i++) {
        const nodeId = sorted[i][0];
        const hits = sorted[i][1];
        const node = nodes.find(n => n.id === nodeId);
        if (node) {
            console.log(`- ${node.callFrame.functionName || '(anonymous)'} (${node.callFrame.url.split('/').pop()}:${node.callFrame.lineNumber}): ${hits} samples`);
        }
    }
    
})();
