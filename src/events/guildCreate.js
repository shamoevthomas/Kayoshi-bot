import { Events } from 'discord.js';
import { cacheGuildInvites } from '../lib/invites.js';

export default {
  name: Events.GuildCreate,
  async execute(guild) {
    // Met en cache les invitations dès que le bot rejoint un nouveau serveur.
    await cacheGuildInvites(guild).catch(() => {});
  },
};
