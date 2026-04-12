const http = require('http');
const fs = require('fs');
const path = require('path');

const RUNS_DIR = path.join(__dirname, 'runs');
if (!fs.existsSync(RUNS_DIR)) fs.mkdirSync(RUNS_DIR, { recursive: true });

http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.end(); return; }
  
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    // Always save as latest
    fs.writeFileSync(path.join(__dirname, 'latest_data.json'), body);
    console.log(`Saved ${body.length} bytes to latest_data.json`);
    
    // Also save timestamped copy to runs/ for archival
    const now = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const runFile = path.join(RUNS_DIR, `run_${now}.json`);
    fs.writeFileSync(runFile, body);
    console.log(`Archived to ${runFile}`);
    
    res.end('ok');
    process.exit(0);
  });
}).listen(9999);
console.log('Save server listening on :9999 (auto-archives to runs/)...');
