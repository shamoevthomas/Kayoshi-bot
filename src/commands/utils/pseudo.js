import { SlashCommandBuilder, escapeMarkdown, ChannelType } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('pseudo')
    .setDescription('Envoie le pseudo d’un membre ou le nom d’un salon.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre'))
    .addChannelOption((o) => o.setName('salon').setDescription('Le salon'))
    .setDMPermission(false),

  async execute(interaction) {
    const member = interaction.options.getMember('membre');
    const channel = interaction.options.getChannel('salon');
    const memberOption = interaction.options.get('membre');

    if (!memberOption && !channel) {
      return interaction.reply({ content: '❌ Choisis un **membre** ou un **salon**.', ephemeral: true });
    }
    // Un membre a été choisi mais il n'est pas (ou plus) sur le serveur.
    if (memberOption && !member) {
      return interaction.reply({ content: '❌ Membre introuvable sur le serveur.', ephemeral: true });
    }

    // Nom du salon, sinon pseudo du membre (pseudo serveur, sinon nom d'affichage, sinon nom d'utilisateur).
    // Aucune mention : un pseudo ou un nom de salon peut contenir « @everyone ».
    const name = channel ? channel.name : member.displayName;
    await interaction.reply({ content: escapeMarkdown(name), allowedMentions: { parse: [] } });
  },
};
