import { Events } from 'discord.js';
import { ensureTracking, getDueTempBans, removeTempBan } from '../lib/store.js';
import { reconcileVerification } from '../lib/verification.js';
import { reconcileTempVoice } from '../lib/tempvoice.js';

async function processTempBans(client) {
  for (const { guildId, userId } of getDueTempBans()) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      removeTempBan(guildId, userId);
      continue;
    }
    await guild.bans.remove(userId, 'Fin du ban temporaire').catch(() => {});
    removeTempBan(guildId, userId);
  }
}

export default {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`✅ Connecté en tant que ${client.user.tag}`);
    // Démarre le suivi arrivées/départs pour chaque serveur.
    for (const [guildId] of client.guilds.cache) ensureTracking(guildId);
    // Vérifie les bans temporaires arrivés à échéance, toutes les 60 s.
    processTempBans(client);
    setInterval(() => processTempBans(client), 60_000);
    // Reprogramme les kicks des membres non vérifiés.
    reconcileVerification(client);
    // Nettoie les vocaux temporaires vides.
    reconcileTempVoice(client);
  },
};
