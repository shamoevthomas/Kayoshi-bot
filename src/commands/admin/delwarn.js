import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { removeWarn } from '../../lib/store.js';

export default {
  data: new SlashCommandBuilder()
    .setName('delwarn')
    .setDescription('Retirer un avertissement précis d’un membre.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addIntegerOption((o) => o.setName('id').setDescription('Numéro du warn (voir /warnings)').setRequired(true).setMinValue(1))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const warnId = interaction.options.getInteger('id');
    const ok = removeWarn(interaction.guild.id, target.id, warnId);
    await interaction.reply({
      content: ok
        ? `✅ Avertissement **#${warnId}** de ${target} retiré.`
        : `❌ Aucun avertissement **#${warnId}** trouvé pour ${target}.`,
      ephemeral: true,
    });
  },
};
