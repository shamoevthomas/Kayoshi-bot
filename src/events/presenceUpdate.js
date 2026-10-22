import { Events } from 'discord.js';
import { reconcileAutoRoles } from '../lib/autoroles.js';

// Dernière présence reçue par membre (`guildId:userId`), pour le diagnostic /statut-role tester :
// permet de savoir si le bot reçoit bien les changements de statut.
export const lastPresenceSeen = new Map();

// À chaque changement de présence : réconcilie tous les rôles automatiques
// (statut mots-clés, statut-role, tag) — un rôle n'est retiré que si AUCUNE
// source ne le réclame.
export default {
  name: Events.PresenceUpdate,
  async execute(oldPresence, newPresence) {
    const guild = newPresence?.guild;
    const member = newPresence?.member;
    if (!guild || !member || member.user?.bot) return;
    const activities = newPresence.activities ?? [];
    lastPresenceSeen.set(`${guild.id}:${member.id}`, {
      at: Date.now(),
      status: newPresence.status,
      count: activities.length,
      text: activities.flatMap((a) => [a.state, a.details].filter(Boolean)).join(' ') || null,
    });
    await reconcileAutoRoles(member).catch(() => {});
  },
};
