import { SlashCommandBuilder } from 'discord.js';
import { renderFamilyCard, familySummary } from '../../lib/family.js';

export default {
  data: new SlashCommandBuilder()
    .setName('family')
    .setDescription('Afficher l’arbre généalogique virtuel (conjoint et membres adoptés).')
    .addUserOption((o) => o.setName('membre').setDescription('(Facultatif) voir la famille d’un autre membre'))
    .setDMPermission(false),

  async execute(interaction) {
    const user = interaction.options.getUser('membre') ?? interaction.user;
    await interaction.deferReply();
    const image = await renderFamilyCard(interaction.guild, user.id);
    await interaction.editReply({ embeds: [familySummary(interaction.guild, user.id).setImage('attachment://famille.png')], files: [image] });
  },
};
