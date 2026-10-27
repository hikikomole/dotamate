const fs = require('fs');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..');
const out = path.join(root, 'outputs/theme-qa/step2');
fs.mkdirSync(out, { recursive: true });
const chrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const server = http.createServer((req, res) => {
  const file = path.resolve(root, '.' + decodeURIComponent(req.url.split('?')[0]), req.url.endsWith('/') ? 'index.html' : '');
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  if (path.extname(file) === '.html') {
    fs.readFile(file, 'utf8', (error, html) => {
      if (error) { res.writeHead(404).end(); return; }
      const theme = req.url.includes('theme=light') ? 'light' : 'dark';
      html = html.replace('<script>try{document.documentElement.dataset.theme=', '<script>localStorage.setItem("dotamate-theme","' + theme + '");try{document.documentElement.dataset.theme=');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
    });
  } else fs.createReadStream(file).on('error', () => res.writeHead(404).end()).pipe(res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }));
});
function run(args) { return new Promise(resolve => { const p = spawn(chrome, args, { stdio: 'ignore' }); p.on('exit', code => resolve(code)); }); }
(async () => {
  await new Promise(resolve => server.listen(18765, '127.0.0.1', resolve));
  const pages = ['meta/', 'academy/', 'academy/match/', 'live/', 'stats/', 'game/', 'me/'];
  for (const page of pages) for (const theme of ['dark', 'light']) for (const width of [1440, 390]) {
    const name = page.replace(/\//g, '-') + theme + '-' + width;
    const code = await run(['--headless=new', '--no-first-run', '--disable-gpu', '--hide-scrollbars', '--disable-extensions', '--disable-background-networking', '--window-size=' + width + ',900', '--virtual-time-budget=5000', '--screenshot=' + path.join(out, name + '.png'), 'http://127.0.0.1:18765/' + page + '?theme=' + theme]);
    console.log(name, code);
  }
  server.close();
})();

