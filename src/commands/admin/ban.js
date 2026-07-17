import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { addTempBan } from '../../lib/store.js';
import { sendLog, Colors } from '../../lib/logger.js';
import { parseDuration, formatDuration } from '../../lib/time.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannir un membre.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre à bannir').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Raison du bannissement'))
    .addStringOption((o) => o.setName('duree').setDescription('Durée (ex: 7d, 12h) — vide = permanent'))
    .addBooleanOption((o) =>
      o.setName('definitif').setDescription('Supprimer ses messages des 7 derniers jours (ex-"ban IP")'),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const reason = interaction.options.getString('raison') ?? 'Aucune raison précisée';
    const durInput = interaction.options.getString('duree');
    const definitif = interaction.options.getBoolean('definitif') ?? false;

    const dur = durInput ? parseDuration(durInput) : { permanent: true, ms: null };
    if (dur === null) {
      return interaction.reply({ content: '❌ Durée invalide. Ex : `7d`, `12h`, `30m`, ou laisse vide pour permanent.', ephemeral: true });
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (member && !member.bannable) {
      return interaction.reply({ content: '❌ Je ne peux pas bannir ce membre (rôle trop haut).', ephemeral: true });
    }

    await interaction.guild.bans.create(target.id, {
      reason: `${reason} — par ${interaction.user.tag}`,
      deleteMessageSeconds: definitif ? 604_800 : 0,
    });

    let note = 'Bannissement **permanent**.';
    if (!dur.permanent) {
      addTempBan(interaction.guild.id, target.id, Date.now() + dur.ms);
      note = `Débannissement automatique dans **${formatDuration(dur.ms)}**.`;
    }

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.delete)
        .setAuthor({ name: definitif ? '💀 Ban définitif' : '🔨 Bannissement' })
        .setDescription(`${target.tag} (\`${target.id}\`)`)
        .addFields(
          { name: 'Durée', value: dur.permanent ? 'Permanent' : formatDuration(dur.ms), inline: true },
          { name: 'Messages supprimés', value: definitif ? '7 jours' : 'Aucun', inline: true },
          { name: 'Raison', value: reason },
          { name: 'Par', value: `${interaction.user}`, inline: true },
        )
        .setTimestamp(),
    );

    await interaction.reply({ content: `✅ **${target.tag}** banni. ${note}\nRaison : ${reason}`, ephemeral: true });
  },
};
