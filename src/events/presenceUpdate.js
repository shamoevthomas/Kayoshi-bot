import { Events } from 'discord.js';
import { reconcileAutoRoles } from '../lib/autoroles.js';
import { checkStatusReward } from '../lib/statusreward.js';

// À chaque changement de présence : réconcilie tous les rôles automatiques
// (règles de statut encore enregistrées, tag) — un rôle n'est retiré que si AUCUNE
// source ne le réclame — et donne la récompense unique du statut (lib/statusreward.js).
export default {
  name: Events.PresenceUpdate,
  async execute(oldPresence, newPresence) {
    const guild = newPresence?.guild;
    const member = newPresence?.member;
    if (!guild || !member || member.user?.bot) return;
    await reconcileAutoRoles(member).catch(() => {});
    await checkStatusReward(member).catch((err) => console.error('[statut récompense]', err));
  },
};
