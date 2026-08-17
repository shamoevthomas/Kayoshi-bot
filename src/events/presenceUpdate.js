import { Events } from 'discord.js';
import { getStatusRoleConfig, getStatutRules } from '../lib/store.js';
import { applyStatusRole, applyStatutRules } from '../lib/statusrole.js';

// À chaque changement de présence : (re)vérifie les mots-clés du statut pour
// ajouter/retirer les rôles correspondants.
export default {
  name: Events.PresenceUpdate,
  async execute(oldPresence, newPresence) {
    const guild = newPresence?.guild;
    const member = newPresence?.member;
    if (!guild || !member || member.user?.bot) return;

    const config = getStatusRoleConfig(guild.id);
    if (config?.text && config.roleId) await applyStatusRole(member, config).catch(() => {});

    const rules = getStatutRules(guild.id);
    if (rules.length) await applyStatutRules(member, rules).catch(() => {});
  },
};
