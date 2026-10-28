import { Events, ActivityType } from 'discord.js';
import { ensureTracking, getDueTempBans, removeTempBan } from '../lib/store.js';
import { reconcileVerification, maybeRemindUnverified } from '../lib/verification.js';
import { reconcileTempVoice } from '../lib/tempvoice.js';
import { cacheAllInvites } from '../lib/invites.js';
import { sweepAutoRoles } from '../lib/autoroles.js';
import { sweepAntiRoles } from '../lib/antirole.js';
import { sweepNickLocks } from '../lib/nicklock.js';
import { rejoinVoiceChannels } from '../lib/voicestay.js';
import { reconcileGiveaways } from '../lib/giveaways.js';
import { refreshAllStats } from '../lib/activity.js';
import { initVoiceSessions } from '../lib/voiceactivity.js';
import { processBumpReminders } from '../lib/bumpreminder.js';
import { ensureVoiceLogChannel } from '../lib/logger.js';
import { startStatsTracking, backfillMessages } from '../lib/stats.js';
import { closeInactiveTickets } from '../lib/tickets.js';
import { reconcileWouldYouRather } from '../lib/wouldyourather.js';
import { processTempRoles } from '../lib/roles.js';
import { processWeeklyTop } from '../lib/weeklytop.js';
import { grantVoiceXp, endXpEvents } from '../lib/voicexp.js';
import { quizTick } from '../lib/quiz.js';
import { refundHolds } from '../lib/bets.js';

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
    client.user.setActivity('.gg/hanamifr', { type: ActivityType.Custom });
    // Casino et duels : les parties en cours sont perdues au redémarrage, les mises en jeu sont rendues.
    refundHolds(client);
    // Démarre le suivi arrivées/départs pour chaque serveur.
    for (const [guildId] of client.guilds.cache) ensureTracking(guildId);
    // Salon « voc-logs » des logs vocaux, créé dès le démarrage pour les serveurs qui ont des logs.
    setTimeout(() => {
      for (const guild of client.guilds.cache.values()) ensureVoiceLogChannel(guild).catch(() => {});
    }, 10_000);
    // Vérifie les bans temporaires arrivés à échéance, toutes les 60 s.
    processTempBans(client);
    setInterval(() => processTempBans(client), 60_000);
    // Rôles temporaires (/roletempo) arrivés à échéance, toutes les 30 s.
    processTempRoles(client).catch((err) => console.error('[roletempo]', err));
    setInterval(() => processTempRoles(client).catch((err) => console.error('[roletempo]', err)), 30_000);
    // Membres de la semaine : récompensés le lundi (vérifié toutes les heures).
    setTimeout(() => processWeeklyTop(client).catch((err) => console.error('[semaine]', err)), 90_000);
    setInterval(() => processWeeklyTop(client).catch((err) => console.error('[semaine]', err)), 3_600_000);
    // Chaque minute : XP en vocal, fin des événements XP (/xp evenement), questions du quiz.
    setInterval(() => {
      grantVoiceXp(client).catch((err) => console.error('[xp vocal]', err));
      endXpEvents(client).catch((err) => console.error('[xp evenement]', err));
      quizTick(client).catch((err) => console.error('[quiz]', err));
    }, 60_000);
    // Reprogramme les kicks des membres non vérifiés.
    reconcileVerification(client);
    // Rappel des membres non vérifiés toutes les 5 h (ticker de contrôle : 30 min).
    setInterval(() => maybeRemindUnverified(client).catch(() => {}), 30 * 60_000);
    // Nettoie les vocaux temporaires vides.
    reconcileTempVoice(client);
    // Rôles automatiques unifiés (statut mots-clés + statut-role + tag) :
    // balayage initial + toutes les 5 min. Un rôle n'est retiré que si AUCUNE
    // source (statut/tag) ne le réclame → plus de conflit entre systèmes.
    setTimeout(() => sweepAutoRoles(client).catch(() => {}), 12_000);
    setInterval(() => sweepAutoRoles(client).catch(() => {}), 300_000);
    // Rôles incompatibles (/antirole) : rattrapage des changements faits hors ligne.
    setTimeout(() => sweepAntiRoles(client).catch(() => {}), 20_000);
    // Pseudos verrouillés (/lockpseudo) : rattrapage des changements faits hors ligne.
    setTimeout(() => sweepNickLocks(client).catch(() => {}), 25_000);
    // Salon vocal de /join : rejoint au démarrage, puis après chaque reconnexion
    // avec nouvelle session (l'état vocal est alors perdu ; pas sur une simple reprise).
    rejoinVoiceChannels(client);
    client.on(Events.ShardReady, () => rejoinVoiceChannels(client));
    // Rappels de bump Disboard (/bremind) arrivés à échéance, toutes les 30 s.
    processBumpReminders(client).catch(() => {});
    setInterval(() => processBumpReminders(client).catch(() => {}), 30_000);
    // Tickets sans message depuis 3 jours : le staff est mentionné et on lui demande s'il faut les fermer (vérifié toutes les heures).
    setTimeout(() => closeInactiveTickets(client).catch((err) => console.error('[tickets]', err)), 120_000);
    setInterval(() => closeInactiveTickets(client).catch((err) => console.error('[tickets]', err)), 3_600_000);
    // Reprend les giveaways en cours (replanifie leur fin après un redémarrage).
    reconcileGiveaways(client).catch(() => {});
    // Pareil pour les votes « Tu préfères… » en cours.
    reconcileWouldYouRather(client);
    // Classement des plus actifs : démarre le suivi vocal des membres déjà connectés,
    // puis actualisation immédiate + toutes les 5 min.
    initVoiceSessions(client);
    // Stats (s?u, s?t, s?m, s?v) : début du suivi, puis historique des messages des
    // 30 derniers jours, une fois par serveur, un serveur après l'autre.
    for (const guild of client.guilds.cache.values()) startStatsTracking(guild.id);
    setTimeout(async () => {
      for (const guild of client.guilds.cache.values()) await backfillMessages(guild).catch((err) => console.error('[stats]', err));
    }, 60_000);
    setTimeout(() => refreshAllStats(client).catch(() => {}), 15_000);
    setInterval(() => refreshAllStats(client).catch(() => {}), 300_000);
  },
};
