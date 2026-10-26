import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { removeWarn, clearWarns } from '../../lib/store.js';

// Retire un avertissement précis (numéro visible dans /casier), ou tous avec l'option « tout ».
export default {
  data: new SlashCommandBuilder()
    .setName('delwarn')
    .setDescription('Retirer un avertissement d’un membre, ou tous ses avertissements.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addIntegerOption((o) => o.setName('id').setDescription('Numéro de l’avertissement (visible dans /casier)').setMinValue(1))
    .addBooleanOption((o) => o.setName('tout').setDescription('Retirer TOUS ses avertissements'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    if (interaction.options.getBoolean('tout')) {
      const count = clearWarns(interaction.guild.id, target.id);
      return interaction.reply({
        content: count ? `✅ ${count} avertissement(s) de ${target} retiré(s).` : `ℹ️ ${target} n’avait aucun avertissement.`,
        ephemeral: true,
      });
    }
    const warnId = interaction.options.getInteger('id');
    if (!warnId) {
      return interaction.reply({
        content: '❌ Donne le numéro de l’avertissement (`id`, visible dans `/casier`), ou mets `tout` à Vrai pour tous les retirer.',
        ephemeral: true,
      });
    }
    const ok = removeWarn(interaction.guild.id, target.id, warnId);
    return interaction.reply({
      content: ok ? `✅ Avertissement **#${warnId}** de ${target} retiré.` : `❌ Aucun avertissement **#${warnId}** trouvé pour ${target}.`,
      ephemeral: true,
    });
  },
};
