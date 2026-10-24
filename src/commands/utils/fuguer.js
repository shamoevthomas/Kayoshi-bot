import { SlashCommandBuilder } from 'discord.js';
import { getRelations, removeAdoption } from '../../lib/family.js';

export default {
  data: new SlashCommandBuilder()
    .setName('fuguer')
    .setDescription('Fuguer : quitter ton parent adoptif (virtuel).')
    .setDMPermission(false),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const { parent } = getRelations(guildId, interaction.user.id);
    if (!parent) return interaction.reply({ content: 'ℹ️ Tu n’as pas de parent adoptif.', ephemeral: true });
    removeAdoption(guildId, parent, interaction.user.id);
    await interaction.reply({ content: `🏃 ${interaction.user} a fugué de chez <@${parent}> !`, allowedMentions: { parse: [] } });
  },
};
