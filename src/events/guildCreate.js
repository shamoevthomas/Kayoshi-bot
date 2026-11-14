import { Events } from 'discord.js';
import { cacheGuildInvites } from '../lib/invites.js';
import { getGuildConfig, setLevelsEnabled } from '../lib/store.js';

export default {
  name: Events.GuildCreate,
  async execute(guild) {
    // Met en cache les invitations dès que le bot rejoint un nouveau serveur.
    await cacheGuildInvites(guild).catch(() => {});
    // Nouveau serveur : système de niveaux désactivé tant qu'un admin ne l'active pas (/config niveau activer).
    // Un serveur déjà réglé avant (bot retiré puis rajouté) garde son réglage.
    if (getGuildConfig(guild.id).levelsEnabled === undefined) setLevelsEnabled(guild.id, false);
  },
};
