import { createServer } from 'node:http';

// Petit serveur HTTP pour que Render considère le bot comme un "web service".
// + auto-ping interne : le bot appelle sa propre URL toutes les 10 min pour
//   empêcher la mise en veille de Render (free tier s'endort après ~15 min).
export function startKeepAlive() {
  const port = process.env.PORT || 3000;
  createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Kayoshi bot en ligne ✅');
  }).listen(port, () => console.log(`🌐 Keep-alive HTTP sur le port ${port}`));

  // Render fournit l'URL publique dans RENDER_EXTERNAL_URL.
  const selfUrl = process.env.RENDER_EXTERNAL_URL;
  if (selfUrl) {
    setInterval(
      () => {
        fetch(selfUrl).catch(() => {});
      },
      10 * 60 * 1000, // toutes les 10 minutes
    );
    console.log(`🔁 Auto-ping activé vers ${selfUrl} (toutes les 10 min)`);
  }
}
