import { Events } from 'discord.js';
import { handleVerifyMessage } from '../lib/verification.js';
import { handleLinkFilter } from '../lib/linkfilter.js';
import { cacheAttachments } from '../lib/attachmentCache.js';
import { bumpGiveawayMessages, bumpActivity, isOneMessageChannel, getCoiffeurEnabled } from '../lib/store.js';

// "quoi" en fin de phrase (mot entier, ponctuation finale tolérée) — pas "pourquoi".
const QUOI_RE = /(?:^|\s)quoi\s*[?!.…]*$/i;

export default {
  name: Events.MessageCreate,
  async execute(message) {
    // Salon "one-message" : tout nouveau message d'un membre est supprimé aussitôt.
    if (message.guild && !message.author?.bot && isOneMessageChannel(message.guild.id, message.channelId)) {
      await message.delete().catch(() => {});
      return;
    }

    await handleVerifyMessage(message).catch((err) => console.error(err));
    await handleLinkFilter(message).catch((err) => console.error(err));
    // Met en cache les photos/vidéos pour pouvoir les ré-afficher si le message est supprimé.
    await cacheAttachments(message).catch((err) => console.error(err));
    // Comptage des messages pour les giveaways avec condition de participation.
    if (message.guild && !message.author?.bot) {
      bumpGiveawayMessages(message.guild.id, message.author.id);
      // Comptage d'activité hebdomadaire (classement /configstat).
      bumpActivity(message.guild.id, message.author.id);
      // Mode coiffeur : "quoi ?" → "feur".
      if (getCoiffeurEnabled(message.guild.id) && QUOI_RE.test(message.content)) {
        await message.reply({ content: 'feur', allowedMentions: { repliedUser: false } }).catch(() => {});
      }
    }
  },
};
