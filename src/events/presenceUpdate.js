import { Events } from 'discord.js';
import { getStatusRoleConfig } from '../lib/store.js';
import { applyStatusRole } from '../lib/statusrole.js';

// À chaque changement de présence : (re)vérifie si le membre a le texte
// déclencheur (ex: l'invite du serveur) dans son statut pour ajouter/retirer le rôle.
export default {
  name: Events.PresenceUpdate,
  async execute(oldPresence, newPresence) {
    const guild = newPresence?.guild;
    const member = newPresence?.member;
    if (!guild || !member || member.user?.bot) return;

    const config = getStatusRoleConfig(guild.id);
    if (!config?.text || !config.roleId) return;

    await applyStatusRole(member, config).catch(() => {});
  },
};
