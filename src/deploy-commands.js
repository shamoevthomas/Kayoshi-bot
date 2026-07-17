import 'dotenv/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REST, Routes } from 'discord.js';
import { loadCommands } from './lib/commands.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('❌ DISCORD_TOKEN et CLIENT_ID sont requis dans .env');
  process.exit(1);
}

const commands = (await loadCommands(join(__dirname, 'commands'))).map((c) => c.data.toJSON());

const rest = new REST().setToken(DISCORD_TOKEN);

try {
  if (GUILD_ID) {
    // Serveur précis = instantané (idéal pour le dev)
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log(`✅ ${commands.length} commande(s) déployée(s) sur le serveur ${GUILD_ID}.`);
  } else {
    // Global = peut prendre jusqu'à 1h à se propager
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log(`✅ ${commands.length} commande(s) déployée(s) globalement.`);
  }
} catch (err) {
  console.error(err);
}
