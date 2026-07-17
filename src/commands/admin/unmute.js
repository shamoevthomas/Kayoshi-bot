import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../../lib/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('unmute')
    .setDescription('Retirer le mute (timeout) d’un membre.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre à démuter').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
    if (!member.isCommunicationDisabled()) {
      return interaction.reply({ content: 'ℹ️ Ce membre n’est pas muet.', ephemeral: true });
    }

    await member.timeout(null, `Démuté par ${interaction.user.tag}`);

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.join)
        .setAuthor({ name: '🔊 Mute retiré' })
        .setDescription(`${target.tag} (\`${target.id}\`)`)
        .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
        .setTimestamp(),
    );

    await interaction.reply({ content: `✅ **${target.tag}** n’est plus muet.`, ephemeral: true });
  },
};
