import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Faire parler le bot dans ce salon.')
    .addStringOption((o) => o.setName('message').setDescription('Le message à envoyer').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false),

  async execute(interaction) {
    const message = interaction.options.getString('message');
    await interaction.channel.send({ content: message, allowedMentions: { parse: [] } });
    await interaction.reply({ content: '✅ Message envoyé.', ephemeral: true });
  },
};
