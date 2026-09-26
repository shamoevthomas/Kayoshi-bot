import { Events } from 'discord.js';
import { handleVerifyMessage } from '../lib/verification.js';
import { handleLinkFilter } from '../lib/linkfilter.js';
import { handleAntiSpam } from '../lib/antispam.js';
import { handleProtectedChannelMention } from '../lib/channelmention.js';
import { handleGifPermHint } from '../lib/gifhint.js';
import { cacheAttachments } from '../lib/attachmentCache.js';
import { bumpGiveawayMessages, bumpActivity, shouldDeleteOneMessage, getCoiffeurEnabled } from '../lib/store.js';

// "quoi" / "pourquoi" en fin de phrase (mot entier, ponctuation finale tolérée).
const QUOI_RE = /(?:^|\s)quoi\s*[?!.…]*$/i;
const POURQUOI_RE = /(?:^|\s)pourquoi\s*[?!.…]*$/i;

export default {
  name: Events.MessageCreate,
  async execute(message) {
    // Salon "one-message" : le message est supprimé aussitôt (pour tous, ou
    // seulement pour les membres ciblés).
    if (
      message.guild &&
      !message.author?.bot &&
      shouldDeleteOneMessage(message.guild.id, message.channelId, message.author.id)
    ) {
      await message.delete().catch(() => {});
      return;
    }

    // Anti-spam : si le message est du spam, il est géré (supprimé) ici.
    if (await handleAntiSpam(message).catch(() => false)) return;

    // Mention d'un salon protégé → message supprimé.
    if (await handleProtectedChannelMention(message).catch(() => false)) return;

    await handleVerifyMessage(message).catch((err) => console.error(err));
    await handleLinkFilter(message).catch((err) => console.error(err));
    // GIF posté sans la permission d'intégrer les liens → explique comment débloquer.
    await handleGifPermHint(message).catch((err) => console.error(err));
    // Met en cache les photos/vidéos pour pouvoir les ré-afficher si le message est supprimé.
    await cacheAttachments(message).catch((err) => console.error(err));
    // Comptage des messages pour les giveaways avec condition de participation.
    if (message.guild && !message.author?.bot) {
      bumpGiveawayMessages(message.guild.id, message.author.id);
      // Comptage d'activité hebdomadaire (classement /configstat).
      bumpActivity(message.guild.id, message.author.id);
      // Mode coiffeur : "quoi ?" → "feur", "pourquoi ?" → "pour feur".
      if (getCoiffeurEnabled(message.guild.id)) {
        const feur = POURQUOI_RE.test(message.content) ? 'pour feur' : QUOI_RE.test(message.content) ? 'feur' : null;
        if (feur) await message.reply({ content: feur, allowedMentions: { repliedUser: false } }).catch(() => {});
      }
    }
  },
};
