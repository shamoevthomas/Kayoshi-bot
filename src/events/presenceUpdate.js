import { Events } from 'discord.js';
import { reconcileAutoRoles } from '../lib/autoroles.js';

// À chaque changement de présence : réconcilie tous les rôles automatiques
// (statut mots-clés, statut-role, tag) — un rôle n'est retiré que si AUCUNE
// source ne le réclame.
export default {
  name: Events.PresenceUpdate,
  async execute(oldPresence, newPresence) {
    const guild = newPresence?.guild;
    const member = newPresence?.member;
    if (!guild || !member || member.user?.bot) return;
    await reconcileAutoRoles(member).catch(() => {});
  },
};
