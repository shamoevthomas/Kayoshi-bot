import { createServer } from 'node:http';

// Petit serveur HTTP pour que Render considère le bot comme un "web service"
// et pour être ping-é par cron-job.org (empêche la mise en veille).
export function startKeepAlive() {
  const port = process.env.PORT || 3000;
  createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Kayoshi bot en ligne ✅');
  }).listen(port, () => console.log(`🌐 Keep-alive HTTP sur le port ${port}`));
}
