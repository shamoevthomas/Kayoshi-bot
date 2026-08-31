import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { addWarn } from '../../lib/store.js';
import { buildWarnPanel } from '../../lib/moderation.js';
import { sendLog, Colors } from '../../lib/logger.js';
import { dmSanction, dmNote } from '../../lib/sanctions.js';

export default {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Donner un avertissement à un membre.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre à avertir').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Raison de l’avertissement').setRequired(true))
    .addBooleanOption((o) =>
      o.setName('afficher_moderateur').setDescription('Afficher ton pseudo au membre dans le MP'),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const reason = interaction.options.getString('raison');
    const showMod = interaction.options.getBoolean('afficher_moderateur') ?? false;

    if (target.bot) {
      return interaction.reply({ content: '❌ On ne peut pas avertir un bot.', ephemeral: true });
    }

    const { warns } = addWarn(interaction.guild.id, target.id, {
      reason,
      moderatorId: interaction.user.id,
    });

    const dmSent = await dmSanction(target, interaction.guild, 'averti', reason, interaction.user, showMod);

    // Log public dans le salon de logs
    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.channel)
        .setAuthor({ name: '⚠️ Avertissement donné' })
        .setDescription(`${target} (${target.tag}) — total : **${warns.length}** warn(s)`)
        .addFields(
          { name: 'Raison', value: reason },
          { name: 'Par', value: `${interaction.user}`, inline: true },
        )
        .setTimestamp(),
    );

    // Panneau éphémère (visible seulement par le modérateur) + boutons Kick / Ban
    const panel = buildWarnPanel(target, warns);
    await interaction.reply({ ...panel, ephemeral: true });
    // Indique au modérateur si le MP est bien passé.
    await interaction.followUp({ content: dmNote(dmSent).trim(), ephemeral: true }).catch(() => {});
  },
};
