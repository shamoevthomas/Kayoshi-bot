import { Events } from 'discord.js';
import { handleVerifyMessage } from '../lib/verification.js';
import { handleLinkFilter } from '../lib/linkfilter.js';
import { cacheAttachments } from '../lib/attachmentCache.js';
import { bumpGiveawayMessages, bumpActivity } from '../lib/store.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    await handleVerifyMessage(message).catch((err) => console.error(err));
    await handleLinkFilter(message).catch((err) => console.error(err));
    // Met en cache les photos/vidéos pour pouvoir les ré-afficher si le message est supprimé.
    await cacheAttachments(message).catch((err) => console.error(err));
    // Comptage des messages pour les giveaways avec condition de participation.
    if (message.guild && !message.author?.bot) {
      bumpGiveawayMessages(message.guild.id, message.author.id);
      // Comptage d'activité hebdomadaire (classement /configstat).
      bumpActivity(message.guild.id, message.author.id);
    }
  },
};
