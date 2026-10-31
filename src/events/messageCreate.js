import { Events } from 'discord.js';
import { handleVerifyMessage } from '../lib/verification.js';
import { handleLinkFilter } from '../lib/linkfilter.js';
import { handleAntiSpam } from '../lib/antispam.js';
import { handleGifPermHint } from '../lib/gifhint.js';
import { cacheAttachments } from '../lib/attachmentCache.js';
import { handleDisboardBump } from '../lib/bumpreminder.js';
import { handlePartnerMessage } from '../lib/partners.js';
import { handleVoiceStatsCommand } from '../lib/voicestats.js';
import { handleSnipeCommand } from '../lib/snipe.js';
import { handleHideCommand } from '../lib/hidechannel.js';
import { handleLockCommand, handleLockdownCommand } from '../lib/lockchannel.js';
import { handleChatGames } from '../lib/chatgames.js';
import { handleQuoteBookCommand } from '../lib/quotebook.js';
import { handleAdventCommand } from '../lib/advent.js';
import { handleMentalistCommand } from '../lib/mentalist.js';
import { handlePrefixCommand } from '../lib/prefix.js';
import { recordMessage } from '../lib/stats.js';
import { handleStatCommand } from '../lib/statcommands.js';
import { handleLoveCommand } from '../lib/lovecalc.js';
import { handleAvatarCommand } from '../lib/avatarcommand.js';
import { handleQuoteCommand } from '../lib/quote.js';
import { handleActionCommand } from '../lib/actions.js';
import { handleBoostSystemMessage } from '../lib/boost.js';
import { noteQuizActivity } from '../lib/quiz.js';
import { grantMessageXp, grantMessageMoney } from '../lib/levels.js';
import { maybeDropMoney } from '../lib/moneydrops.js';
import { checkQuests } from '../lib/quests.js';
import { handleCountingMessage } from '../lib/counting.js';
import { handleGuessFlagMessage } from '../lib/guessflag.js';
import { bumpGiveawayMessages, bumpActivity, shouldDeleteOneMessage, getCoiffeurEnabled } from '../lib/store.js';

// "quoi" / "pourquoi" en fin de phrase (mot entier, ponctuation finale tolérée).
const QUOI_RE = /(?:^|\s)quoi\s*[?!.…]*$/i;
const POURQUOI_RE = /(?:^|\s)pourquoi\s*[?!.…]*$/i;

export default {
  name: Events.MessageCreate,
  async execute(message) {
    // Message système « … a boosté le serveur » : message de boost (/configboost), rien d'autre.
    if (await handleBoostSystemMessage(message).catch((err) => console.error('[boost]', err))) return;
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

    // Commandes du casino « . » (.balance, .dep, .bj…) : traitées ici, sans XP ni argent pour le message.
    if (await handlePrefixCommand(message).catch((err) => (console.error('[casino .]', err), true))) return;
    // Jeux du chat (+pendu, +devine, +emoji) : lancement et essais, sans XP ni argent pour le message.
    if (await handleChatGames(message).catch((err) => (console.error('[jeux]', err), false))) return;

    // Serveur actif : le quiz ne pose ses questions que dans ce cas.
    noteQuizActivity(message);
    // Salon de comptage (/compteur) : 1, 2, 3… à tour de rôle.
    await handleCountingMessage(message).catch((err) => console.error('[compteur]', err));

    // « +vc » : statistiques des salons vocaux.
    await handleVoiceStatsCommand(message).catch((err) => console.error(err));
    // « +snipe » (staff) : dernier message supprimé du salon.
    await handleSnipeCommand(message).catch((err) => console.error('[snipe]', err));
    // « +hide » / « +unhide » (staff) : masquer ou réafficher un salon pour le rôle Membre.
    await handleHideCommand(message).catch((err) => console.error('[hide]', err));
    // « +lock [raison] » / « +unlock » (staff) : verrouiller ou déverrouiller l'écriture pour le rôle Membre.
    await handleLockCommand(message).catch((err) => console.error('[lock]', err));
    // « +lockdown [raison] » / « +unlockdown » (staff) : tous les salons d'un coup, remis comme avant ensuite.
    await handleLockdownCommand(message).catch((err) => console.error('[lockdown]', err));
    // « +citation » : livre des citations (réaction 📖) ; « +avent » : calendrier de l'Avent (1er → 24 décembre).
    await handleQuoteBookCommand(message).catch((err) => console.error('[citations]', err));
    await handleAdventCommand(message).catch((err) => console.error('[avent]', err));
    // « +mentaliste » : le bot devine le personnage auquel on pense.
    await handleMentalistCommand(message).catch((err) => console.error('[mentaliste]', err));
    // Stats d'activité (messages par membre et par salon), puis s?u / s?t / s?m / s?v.
    try {
      recordMessage(message);
    } catch (err) {
      console.error('[stats]', err);
    }
    await handleStatCommand(message).catch((err) => console.error('[stats]', err));
    // ^^lc / ^^hc / ^^fc : pourcentage d'amour, de haine ou d'amitié (comme Koya).
    await handleLoveCommand(message).catch((err) => console.error('[lovecalc]', err));
    // « kayo pp [@membre] » : photo de profil du membre.
    await handleAvatarCommand(message).catch((err) => console.error('[avatar]', err));
    // Réponse à un message en mentionnant le bot : citation du message en image.
    await handleQuoteCommand(message).catch((err) => console.error('[quote]', err));
    // « kayo hug / kiss / slap @membre » (ou « hana … ») : GIF d'anime.
    await handleActionCommand(message).catch((err) => console.error('[actions]', err));
    // XP : gain par message + annonce de passage de niveau.
    await grantMessageXp(message).catch((err) => console.error('[levels]', err));
    // Argent : gain par message (5$, ou 25$ si > 125 caractères).
    try {
      grantMessageMoney(message);
    } catch (err) {
      console.error('[money]', err);
    }
    // Drop d'argent à ramasser, de temps en temps, dans les salons choisis (/configeconomie).
    await maybeDropMoney(message).catch((err) => console.error('[drops]', err));
    // Quêtes de la semaine : paie celles que ce message (ou le vocal d'avant) vient de terminer.
    if (message.guild && !message.author.bot) await checkQuests(message).catch((err) => console.error('[quetes]', err));

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
