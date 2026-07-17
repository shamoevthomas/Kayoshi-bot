import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../../lib/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulser un membre du serveur.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre à expulser').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Raison de l’expulsion'))
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const reason = interaction.options.getString('raison') ?? 'Aucune raison précisée';
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);

    if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
    if (!member.kickable) return interaction.reply({ content: '❌ Je ne peux pas expulser ce membre (rôle trop haut).', ephemeral: true });

    await member.kick(`${reason} — par ${interaction.user.tag}`);

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.leave)
        .setAuthor({ name: '👢 Membre expulsé' })
        .setDescription(`${target.tag} (\`${target.id}\`)`)
        .addFields(
          { name: 'Raison', value: reason },
          { name: 'Par', value: `${interaction.user}`, inline: true },
        )
        .setTimestamp(),
    );

    await interaction.reply({ content: `✅ **${target.tag}** a été expulsé.\nRaison : ${reason}`, ephemeral: true });
  },
};
