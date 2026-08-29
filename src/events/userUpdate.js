import { Events } from 'discord.js';
import { getTagRoleConfig } from '../lib/store.js';
import { applyTagRole } from '../lib/tagrole.js';

// Quand un utilisateur change de tag de serveur (primaryGuild), on réévalue le
// rôle de tag dans chaque serveur où il est membre.
export default {
  name: Events.UserUpdate,
  async execute(oldUser, newUser) {
    for (const [, guild] of newUser.client.guilds.cache) {
      const config = getTagRoleConfig(guild.id);
      if (!config?.roleId) continue;
      const member = guild.members.cache.get(newUser.id);
      if (member) await applyTagRole(member, config).catch(() => {});
    }
  },
};
