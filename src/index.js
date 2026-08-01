import 'dotenv/config';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Client, Collection, GatewayIntentBits, Partials } from 'discord.js';
import { loadCommands } from './lib/commands.js';
import { initStore, flushStore } from './lib/store.js';
import { startKeepAlive } from './keepalive.js';

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
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
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

client.login(process.env.DISCORD_TOKEN);
