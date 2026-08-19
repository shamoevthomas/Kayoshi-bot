import { Events, ActivityType } from 'discord.js';
import { ensureTracking, getDueTempBans, removeTempBan } from '../lib/store.js';
import { reconcileVerification, maybeRemindUnverified } from '../lib/verification.js';
import { reconcileTempVoice } from '../lib/tempvoice.js';
import { cacheAllInvites } from '../lib/invites.js';
import { getStatusRoleConfig, getStatutRules } from '../lib/store.js';
import { sweepAllStatusRoles, sweepAllStatutRules } from '../lib/statusrole.js';
import { reconcileGiveaways } from '../lib/giveaways.js';
import { refreshAllStats } from '../lib/activity.js';
import { initVoiceSessions } from '../lib/voiceactivity.js';
import { pollAllCreators } from '../lib/creators.js';

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
  async execute(client) {
    console.log(`✅ Connecté en tant que ${client.user.tag}`);
    // Met en cache les invitations de chaque serveur (pour le suivi des invitations).
    await cacheAllInvites(client).catch((err) => console.error(err));
    // Statut du bot.
    client.user.setActivity('Le meilleur serv .gg/ximi', { type: ActivityType.Watching });
    // Démarre le suivi arrivées/départs pour chaque serveur.
    for (const [guildId] of client.guilds.cache) ensureTracking(guildId);
    // Vérifie les bans temporaires arrivés à échéance, toutes les 60 s.
    processTempBans(client);
    setInterval(() => processTempBans(client), 60_000);
    // Reprogramme les kicks des membres non vérifiés.
    reconcileVerification(client);
    // Rappel des membres non vérifiés toutes les 5 h (ticker de contrôle : 30 min).
    setInterval(() => maybeRemindUnverified(client).catch(() => {}), 30 * 60_000);
    // Nettoie les vocaux temporaires vides.
    reconcileTempVoice(client);
    // Rôle selon le statut : balayage initial + toutes les 5 min
    // (rattrape les membres déjà en ligne et retire le rôle si le texte a disparu).
    setTimeout(() => sweepAllStatusRoles(client, getStatusRoleConfig).catch(() => {}), 10_000);
    setInterval(() => sweepAllStatusRoles(client, getStatusRoleConfig).catch(() => {}), 300_000);
    // Idem pour les règles multi-mots-clés (/statut).
    setTimeout(() => sweepAllStatutRules(client, getStatutRules).catch(() => {}), 12_000);
    setInterval(() => sweepAllStatutRules(client, getStatutRules).catch(() => {}), 300_000);
    // Reprend les giveaways en cours (replanifie leur fin après un redémarrage).
    reconcileGiveaways(client).catch(() => {});
    // Veille YouTube/TikTok : nouvelles vidéos postées dans les salons suivis.
    setTimeout(() => pollAllCreators(client).catch(() => {}), 30_000);
    setInterval(() => pollAllCreators(client).catch(() => {}), 600_000);
    // Classement des plus actifs : démarre le suivi vocal des membres déjà connectés,
    // puis actualisation immédiate + toutes les 5 min.
    initVoiceSessions(client);
    setTimeout(() => refreshAllStats(client).catch(() => {}), 15_000);
    setInterval(() => refreshAllStats(client).catch(() => {}), 300_000);
  },
};
