import 'dotenv/config';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { loadCommands } from './lib/commands.js';
import { initStore, flushStore } from './lib/store.js';
import { startKeepAlive } from './keepalive.js';

// Garde-fous : une erreur asynchrone non gérée ne doit JAMAIS tuer le process
// (sinon le bot tombe et Render peut ne pas le relancer).
process.on('unhandledRejection', (reason) => {
  console.error('⚠️ unhandledRejection :', reason);
});
process.on('uncaughtException', (err) => {
  console.error('⚠️ uncaughtException :', err);
});

// Serveur HTTP keep-alive (Render + cron-job.org)
startKeepAlive();

// Charge les données depuis Supabase AVANT de se connecter à Discord.
await initStore();

const __dirname = dirname(fileURLToPath(import.meta.url));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers, // changements de rôles (privilégié)
    GatewayIntentBits.GuildVoiceStates, // join/quit vocal
    GatewayIntentBits.GuildMessages, // suppression de messages
    GatewayIntentBits.MessageContent, // contenu des messages supprimés (privilégié)
    GatewayIntentBits.GuildEmojisAndStickers, // ajout emoji/sticker
    GatewayIntentBits.GuildModeration, // bannissements (event guildBanAdd)
    GatewayIntentBits.GuildInvites, // suivi des invitations (qui a invité qui)
    GatewayIntentBits.GuildPresences, // lecture des statuts (rôle si invite dans le statut) — privilégié
    GatewayIntentBits.GuildMessageReactions, // réaction 📖 : livre des citations
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.Reaction, Partials.User],
  // Ajout d'emojis (/copyemoji) et profil du bot (/profilbot) : quand Discord impose une longue
  // attente, on abandonne au lieu d'attendre en silence ; la commande dit quand réessayer.
  rest: {
    rejectOnRateLimit: (info) =>
      ((info.method === 'POST' && /\/guilds\/\d+\/emojis(?:\?|$)/.test(info.url)) ||
        (info.method === 'PATCH' && /\/guilds\/\d+\/members\/@me(?:\?|$)/.test(info.url))) &&
      Math.max(info.retryAfter, info.timeToReset) > 30_000,
  },
});

// --- Commandes (chargement récursif de src/commands) ---
client.commands = new Collection();
for (const command of await loadCommands(join(__dirname, 'commands'))) {
  client.commands.set(command.data.name, command);
}

// --- Events (src/events/*.js exportent { name, once?, execute }) ---
const eventsPath = join(__dirname, 'events');
for (const file of readdirSync(eventsPath).filter((f) => f.endsWith('.js'))) {
  const event = (await import(pathToFileURL(join(eventsPath, file)).href)).default;
  if (!event?.name || !event?.execute) continue;
  if (event.once) client.once(event.name, (...args) => event.execute(...args));
  else client.on(event.name, (...args) => event.execute(...args));
}

// Arrêt propre : on écrit les données en attente avant de quitter.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    console.log(`\n${signal} reçu — sauvegarde et arrêt…`);
    await flushStore().catch(() => {});
    client.destroy();
    process.exit(0);
  });
}

// Avant la connexion : Discord répond-il depuis l'hébergeur ? Une adresse bloquée par Discord fait attendre la
// connexion sans aucun message ; ici, la raison est écrite dans les journaux.
const probe = await fetch('https://discord.com/api/v10/gateway/bot', {
  headers: { Authorization: `Bot ${process.env.DISCORD_TOKEN}` },
  signal: AbortSignal.timeout(15_000),
}).catch((err) => ({ status: 0, error: err }));
if (probe.status === 200) console.log('🔌 Discord joignable, connexion…');
else if (probe.status === 401) console.error('❌ Jeton Discord refusé (401) : vérifie DISCORD_TOKEN dans les réglages de l’hébergeur.');
else if (probe.status === 429) {
  const body = (await probe.text().catch(() => '')) || '';
  console.error(
    `⛔ Discord bloque temporairement cette adresse (429${/1015|cloudflare/i.test(body) ? ', Cloudflare' : ''}), ` +
      `nouvel essai possible dans ${probe.headers.get('retry-after') ?? '?'} s.`,
  );
} else console.error(`⚠️ Discord injoignable depuis l’hébergeur (${probe.status || probe.error?.message}).`);

// Longues attentes imposées par Discord : écrites dans les journaux.
client.rest.on('rateLimited', (info) => {
  if (info.global || info.timeToReset > 60_000) {
    console.warn(`⏳ Limite Discord ${info.global ? 'globale' : info.route} : reprise dans ${Math.round(info.timeToReset / 1000)} s.`);
  }
});

// Garde-fou : pas connecté à Discord depuis 5 min (au démarrage ou après une coupure) → on sauvegarde et on quitte,
// l'hébergeur relance le bot. Évite de rester « en ligne » sur Render mais absent de Discord pendant des heures.
let offlineSince = Date.now();
setInterval(async () => {
  if (client.isReady()) {
    offlineSince = null;
    return;
  }
  offlineSince ??= Date.now();
  if (Date.now() - offlineSince < 5 * 60_000) return;
  console.error('⚠️ Pas connecté à Discord depuis 5 min : sauvegarde puis redémarrage du bot.');
  await flushStore().catch(() => {});
  process.exit(1);
}, 30_000);

client.login(process.env.DISCORD_TOKEN).catch((err) => console.error('❌ Connexion à Discord impossible :', err.message));
