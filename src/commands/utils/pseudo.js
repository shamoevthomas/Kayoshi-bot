import { SlashCommandBuilder, escapeMarkdown } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('pseudo')
    .setDescription('Envoie le pseudo d’un membre.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .setDMPermission(false),

  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    if (!member) return interaction.reply({ content: '❌ Membre introuvable sur le serveur.', ephemeral: true });

    // Pseudo sur le serveur, sinon nom d'affichage, sinon nom d'utilisateur.
    // Aucune mention : un pseudo peut contenir « @everyone ».
    await interaction.reply({ content: escapeMarkdown(member.displayName), allowedMentions: { parse: [] } });
  },
};
