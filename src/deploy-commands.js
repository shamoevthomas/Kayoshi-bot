import 'dotenv/config';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REST, Routes, ApplicationIntegrationType } from 'discord.js';
import { loadCommands } from './lib/commands.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;

if (!DISCORD_TOKEN || !CLIENT_ID) {
  console.error('❌ DISCORD_TOKEN et CLIENT_ID sont requis dans .env');
  process.exit(1);
}

const commands = (await loadCommands(join(__dirname, 'commands'))).map((c) => c.data.toJSON());
// Commandes utilisables en application externe (installée sur un compte, ex. /say) : Discord
// ne les accepte qu'en commandes globales. Les autres restent sur le(s) serveur(s) de GUILD_ID.
const userInstallable = (c) => c.integration_types?.includes(ApplicationIntegrationType.UserInstall);
const globalCommands = commands.filter(userInstallable);
const guildCommands = commands.filter((c) => !userInstallable(c));
// GUILD_ID peut lister plusieurs serveurs, séparés par des virgules.
const guildIds = (GUILD_ID ?? '').split(',').map((id) => id.trim()).filter(Boolean);

const rest = new REST().setToken(DISCORD_TOKEN);

try {
  if (guildIds.length) {
    // Serveur précis = instantané (idéal pour le dev)
    for (const guildId of guildIds) {
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, guildId), { body: guildCommands });
      console.log(`✅ ${guildCommands.length} commande(s) déployée(s) sur le serveur ${guildId}.`);
    }
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: globalCommands });
    console.log(`✅ ${globalCommands.length} commande(s) globale(s) (application externe) : ${globalCommands.map((c) => `/${c.name}`).join(' ') || '-'}.`);
  } else {
    // Global = peut prendre jusqu'à 1h à se propager
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log(`✅ ${commands.length} commande(s) déployée(s) globalement.`);
  }
} catch (err) {
  console.error(err);
}
