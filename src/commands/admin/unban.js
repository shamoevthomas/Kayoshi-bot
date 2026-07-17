import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { removeTempBan } from '../../lib/store.js';
import { sendLog, Colors } from '../../lib/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Débannir un utilisateur via son ID.')
    .addStringOption((o) => o.setName('id').setDescription('ID de l’utilisateur banni').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const userId = interaction.options.getString('id').trim();
    const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
    if (!ban) {
      return interaction.reply({ content: '❌ Aucun ban trouvé pour cet ID.', ephemeral: true });
    }
    await interaction.guild.bans.remove(userId, `Débanni par ${interaction.user.tag}`);
    removeTempBan(interaction.guild.id, userId);

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.join)
        .setAuthor({ name: '♻️ Débannissement' })
        .setDescription(`${ban.user.tag} (\`${userId}\`)`)
        .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
        .setTimestamp(),
    );

    await interaction.reply({ content: `✅ **${ban.user.tag}** a été débanni.`, ephemeral: true });
  },
};
