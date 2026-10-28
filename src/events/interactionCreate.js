import { Events } from 'discord.js';
import { handleModerationInteraction } from '../lib/moderation.js';
import { handleTicketInteraction } from '../lib/tickets.js';
import { handleTempVoiceInteraction } from '../lib/tempvoice.js';
import { handleGiveawayInteraction } from '../lib/giveaways.js';
import { handleAvisInteraction } from '../lib/avis.js';
import { handleEmbedBuilderInteraction } from '../lib/embedbuilder.js';
import { handleLoveInteraction } from '../lib/lovecalc.js';
import { handleGuessFlagInteraction } from '../lib/guessflag.js';
import { handleWouldYouRatherInteraction } from '../lib/wouldyourather.js';
import { handleFamilyInteraction } from '../lib/family.js';
import { openShop, handleShopInteraction } from '../lib/shop.js';
import { handleConfessionInteraction } from '../lib/confessions.js';
import { handleQuoteInteraction } from '../lib/quote.js';
import { HELP_MENU_ID, handleHelpInteraction } from '../lib/help.js';
import { handleDropInteraction } from '../lib/moneydrops.js';
import { handleStatusRoleModal } from '../lib/statusrole.js';
import { handleTopInteraction } from '../lib/leaderboards.js';
import { handleQuizInteraction } from '../lib/quiz.js';
import { handleCasinoInteraction } from '../lib/casino.js';
import { handleDuelInteraction } from '../lib/duel.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    // Composants (boutons, menus) + formulaires persistants : modération & tickets
    if (interaction.isMessageComponent() || interaction.isModalSubmit()) {
      const cid = interaction.customId ?? '';
      try {
        if (cid.startsWith('mod_')) return void (await handleModerationInteraction(interaction));
        if (cid.startsWith('ticket_')) return void (await handleTicketInteraction(interaction));
        if (cid.startsWith('tv_')) return void (await handleTempVoiceInteraction(interaction));
        if (cid.startsWith('gw_')) return void (await handleGiveawayInteraction(interaction));
        if (cid.startsWith('avis_')) return void (await handleAvisInteraction(interaction));
        if (cid.startsWith('emb_')) return void (await handleEmbedBuilderInteraction(interaction));
        if (cid.startsWith('lc_')) return void (await handleLoveInteraction(interaction));
        if (cid.startsWith('gf_')) return void (await handleGuessFlagInteraction(interaction));
        if (cid.startsWith('tp_')) return void (await handleWouldYouRatherInteraction(interaction));
        if (cid.startsWith('fam_')) return void (await handleFamilyInteraction(interaction));
        if (cid.startsWith('conf_')) return void (await handleConfessionInteraction(interaction));
        if (cid.startsWith('qt_')) return void (await handleQuoteInteraction(interaction));
        if (cid === HELP_MENU_ID) return void (await handleHelpInteraction(interaction));
        if (cid.startsWith('drop_claim:')) return void (await handleDropInteraction(interaction));
        if (cid.startsWith('stat_kw:')) return void (await handleStatusRoleModal(interaction));
        if (cid.startsWith('top:')) return void (await handleTopInteraction(interaction));
        if (cid.startsWith('quiz_ans:')) return void (await handleQuizInteraction(interaction));
        if (cid.startsWith('cas_')) return void (await handleCasinoInteraction(interaction));
        if (cid.startsWith('duel:')) return void (await handleDuelInteraction(interaction));
        if (cid === 'shop_open') return void (await openShop(interaction));
        if (cid.startsWith('shop_')) return void (await handleShopInteraction(interaction));
      } catch (err) {
        console.error(err);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Une erreur est survenue.', ephemeral: true }).catch(() => {});
        }
      }
      // Les composants "cfg_", "log_", "bilan_" sont gérés par des collecteurs dans leurs commandes.
      return;
    }

    // Autocomplétion des options (ex. /modifierembed)
    if (interaction.isAutocomplete()) {
      const command = interaction.client.commands.get(interaction.commandName);
      await command?.autocomplete?.(interaction).catch((err) => console.error(err));
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction);
    } catch (err) {
      console.error(err);
      const reply = { content: 'Une erreur est survenue.', ephemeral: true };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
      } else {
        await interaction.reply(reply).catch(() => {});
      }
    }
  },
};
