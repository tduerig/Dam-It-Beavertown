const http = require('http');
const fs = require('fs');
http.createServer((req, res) => {
  let body = '';
  req.on('data', chunk => body += chunk);
  req.on('end', () => {
    fs.writeFileSync('simtests/latest_data.json', body);
    res.end('ok');
    process.exit(0);
  });
}).listen(9999);
console.log('Listening on 9999...');
