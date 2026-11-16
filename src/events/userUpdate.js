import { Events } from 'discord.js';
import { hasAutoRoles, reconcileAutoRoles } from '../lib/autoroles.js';
import { checkRewards } from '../lib/statusreward.js';

// Quand un utilisateur change (tag de serveur, etc.), on réconcilie ses rôles
// automatiques dans chaque serveur où il est membre, et on donne la récompense du tag s'il vient de le mettre.
export default {
  name: Events.UserUpdate,
  async execute(oldUser, newUser) {
    for (const [, guild] of newUser.client.guilds.cache) {
      const member = guild.members.cache.get(newUser.id);
      if (!member) continue;
      if (hasAutoRoles(guild.id)) await reconcileAutoRoles(member).catch(() => {});
      await checkRewards(member, ['tag']);
    }
  },
};
