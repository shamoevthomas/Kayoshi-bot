import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../../lib/logger.js';
import { parseDuration, formatDuration } from '../../lib/time.js';

const MAX_TIMEOUT = 28 * 86_400_000; // Discord : max 28 jours

export default {
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Rendre un membre muet (timeout) pour une durée.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre à rendre muet').setRequired(true))
    .addStringOption((o) => o.setName('duree').setDescription('Durée (ex: 10m, 1h, 1d — max 28d)').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Raison du mute'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const reason = interaction.options.getString('raison') ?? 'Aucune raison précisée';
    const dur = parseDuration(interaction.options.getString('duree'));

    if (dur === null || dur.permanent) {
      return interaction.reply({ content: '❌ Précise une durée valide (ex: `10m`, `1h`, `1d`). Max 28 jours.', ephemeral: true });
    }
    if (dur.ms > MAX_TIMEOUT) {
      return interaction.reply({ content: '❌ Durée max autorisée par Discord : **28 jours**.', ephemeral: true });
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
    if (!member.moderatable) return interaction.reply({ content: '❌ Je ne peux pas rendre ce membre muet (rôle trop haut).', ephemeral: true });

    await member.timeout(dur.ms, `${reason} — par ${interaction.user.tag}`);

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.channel)
        .setAuthor({ name: '🔇 Membre rendu muet' })
        .setDescription(`${target.tag} (\`${target.id}\`)`)
        .addFields(
          { name: 'Durée', value: formatDuration(dur.ms), inline: true },
          { name: 'Raison', value: reason },
          { name: 'Par', value: `${interaction.user}`, inline: true },
        )
        .setTimestamp(),
    );

    await interaction.reply({ content: `✅ **${target.tag}** est muet pour **${formatDuration(dur.ms)}**.\nRaison : ${reason}`, ephemeral: true });
  },
};
