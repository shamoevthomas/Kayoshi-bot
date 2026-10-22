import { Events } from 'discord.js';
import { handleVerifyMessage } from '../lib/verification.js';
import { handleLinkFilter } from '../lib/linkfilter.js';
import { handleAntiSpam } from '../lib/antispam.js';
import { handleGifPermHint } from '../lib/gifhint.js';
import { cacheAttachments } from '../lib/attachmentCache.js';
import { handleDisboardBump } from '../lib/bumpreminder.js';
import { handlePartnerMessage } from '../lib/partners.js';
import { handleVoiceStatsCommand } from '../lib/voicestats.js';
import { recordMessage } from '../lib/stats.js';
import { handleStatCommand } from '../lib/statcommands.js';
import { handleLoveCommand } from '../lib/lovecalc.js';
import { handleAvatarCommand } from '../lib/avatarcommand.js';
import { grantMessageXp } from '../lib/levels.js';
import { handleGuessFlagMessage } from '../lib/guessflag.js';
import { bumpGiveawayMessages, bumpActivity, shouldDeleteOneMessage, getCoiffeurEnabled } from '../lib/store.js';

// "quoi" / "pourquoi" en fin de phrase (mot entier, ponctuation finale tolérée).
const QUOI_RE = /(?:^|\s)quoi\s*[?!.…]*$/i;
const POURQUOI_RE = /(?:^|\s)pourquoi\s*[?!.…]*$/i;

export default {
  name: Events.MessageCreate,
  async execute(message) {
    // /bump réussi avec Disboard → remerciement + rappel dans 2 h (/bremind).
    await handleDisboardBump(message).catch((err) => console.error(err));

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

    // Salon du jeu « Devine le drapeau » : chaque message est une réponse, supprimée aussitôt
    // (avant l'anti-spam : répondre vite n'est pas du spam).
    if (await handleGuessFlagMessage(message).catch((err) => console.error('[guessflag]', err))) return;

    // Anti-spam : si le message est du spam, il est géré (supprimé) ici.
    const spam = await handleAntiSpam(message).catch((err) => {
      console.error('[antispam]', err);
      return false;
    });
    if (spam) return;

    // « +vc » : statistiques des salons vocaux.
    await handleVoiceStatsCommand(message).catch((err) => console.error(err));
    // Stats d'activité (messages par membre et par salon), puis s?u / s?t / s?m / s?v.
    recordMessage(message);
    await handleStatCommand(message).catch((err) => console.error('[stats]', err));
    // ^^lc / ^^hc / ^^fc : pourcentage d'amour, de haine ou d'amitié (comme Koya).
    await handleLoveCommand(message).catch((err) => console.error('[lovecalc]', err));
    // « kayo pp [@membre] » : photo de profil du membre.
    await handleAvatarCommand(message).catch((err) => console.error('[avatar]', err));
    // XP : gain par message + annonce de passage de niveau.
    await grantMessageXp(message).catch((err) => console.error('[levels]', err));

    await handleVerifyMessage(message).catch((err) => console.error(err));
    await handleLinkFilter(message).catch((err) => console.error(err));
    // Salon partenariat : +1 partenariat pour l'auteur, puis envoi de l'embed.
    await handlePartnerMessage(message).catch((err) => console.error(err));
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
