import { Events } from 'discord.js';
import { handleModerationInteraction } from '../lib/moderation.js';
import { handleTicketInteraction } from '../lib/tickets.js';
import { handleTempVoiceInteraction } from '../lib/tempvoice.js';

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
      } catch (err) {
        console.error(err);
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'Une erreur est survenue.', ephemeral: true }).catch(() => {});
        }
      }
      // Les composants "cfg_", "log_", "bilan_" sont gérés par des collecteurs dans leurs commandes.
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
