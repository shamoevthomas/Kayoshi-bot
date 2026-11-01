import { getGuildConfig, setGuildConfig } from './store.js';

// Retour en ligne après une coupure : le bot note toutes les 5 min qu'il est connecté. À la connexion, si la
// dernière note date de plus de 15 min, il prévient en MP les membres de NOTIFY (un simple redémarrage ne dit rien).
const NOTIFY = ['1260266494839754866']; // l0un4tik
const HOME = '1563159382361907350'; // Hanami : la note est gardée dans ses données
const BEAT_MS = 5 * 60_000;
const OUTAGE_MS = 15 * 60_000;
// Première coupure suivie (avant que la note existe) : blocage de l'hébergeur par Discord, le 1er novembre 2026 à 00 h 25.
const FIRST_OUTAGE = Date.parse('2026-10-31T23:25:00Z');

const beat = () => setGuildConfig(HOME, { botStatus: { lastAlive: Date.now() } });

function duration(ms) {
  const minutes = Math.round(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  return [days && `${days} j`, hours && `${hours} h`, rest && `${rest} min`].filter(Boolean).join(' ') || 'quelques minutes';
}

export async function announceReturn(client) {
  const last = getGuildConfig(HOME).botStatus?.lastAlive ?? FIRST_OUTAGE;
  beat();
  setInterval(beat, BEAT_MS);
  const offline = Date.now() - last;
  if (offline < OUTAGE_MS) return;
  const text =
    `✅ **${client.user.username} est de retour en ligne !**\n` +
    `Il était hors ligne depuis le <t:${Math.floor(last / 1000)}:f> (environ ${duration(offline)}).`;
  for (const id of NOTIFY) {
    const user = await client.users.fetch(id).catch(() => null);
    await user?.send(text).catch((err) => console.error('[retour en ligne] MP impossible :', err.message));
  }
  console.log(`📣 Retour en ligne annoncé (coupure de ${duration(offline)}).`);
}
