import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../../lib/logger.js';
import { dmSanction, dmNote } from '../../lib/sanctions.js';

export default {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Expulser un membre du serveur.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre à expulser').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Raison de l’expulsion').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('afficher_moderateur')
        .setDescription('Afficher ton pseudo au membre dans le MP ?')
        .setRequired(true)
        .addChoices({ name: 'Montrer', value: 'montrer' }, { name: 'Ne pas montrer', value: 'ne pas montrer' }),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const reason = interaction.options.getString('raison');
    const showMod = interaction.options.getString('afficher_moderateur') === 'montrer';
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);

    if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
    if (!member.kickable) return interaction.reply({ content: '❌ Je ne peux pas expulser ce membre (rôle trop haut).', ephemeral: true });

    // MP AVANT l'expulsion (plus dans le serveur ensuite).
    const dmSent = await dmSanction(target, interaction.guild, 'expulsé', reason, interaction.user, showMod);

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

    await interaction.reply({ content: `✅ **${target.tag}** a été expulsé.\nRaison : ${reason}${dmNote(dmSent)}`, ephemeral: true });
  },
};
