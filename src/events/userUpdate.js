import { Events } from 'discord.js';
import { hasAutoRoles, reconcileAutoRoles } from '../lib/autoroles.js';

// Quand un utilisateur change (tag de serveur, etc.), on réconcilie ses rôles
// automatiques dans chaque serveur où il est membre.
export default {
  name: Events.UserUpdate,
  async execute(oldUser, newUser) {
    for (const [, guild] of newUser.client.guilds.cache) {
      if (!hasAutoRoles(guild.id)) continue;
      const member = guild.members.cache.get(newUser.id);
      if (member) await reconcileAutoRoles(member).catch(() => {});
    }
  },
};
