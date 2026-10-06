import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getJailRecord, setJailRecord, removeJailRecord } from '../../lib/store.js';
import { sendSanctionLog, Colors } from '../../lib/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('unjail')
    .setDescription('Libérer un membre jail : il retrouve le rôle perdu et perd le rôle de jail.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre à libérer').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false),

  async execute(interaction) {
    const guild = interaction.guild;
    const target = interaction.options.getUser('membre');
    const rec = getJailRecord(guild.id, target.id);
    if (!rec) return interaction.reply({ content: `ℹ️ ${target} n’est pas jail.`, ephemeral: true });

    // Supprimé AVANT les changements de rôles : sinon le rôle rendu serait aussitôt retiré.
    removeJailRecord(guild.id, target.id);

    const member = await guild.members.fetch(target.id).catch(() => null);
    if (!member) {
      return interaction.reply({
        content: `✅ ${target} n’est plus sur le serveur : il est libéré et ne sera plus jail à son retour.`,
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });
    const auditReason = `Unjail par ${interaction.user.tag}`;
    try {
      await member.roles.remove(rec.addRoleId, auditReason);
      if (rec.hadRole) await member.roles.add(rec.removeRoleId, auditReason);
    } catch (err) {
      setJailRecord(guild.id, target.id, rec);
      return interaction.editReply({ content: `❌ Impossible de libérer ce membre : ${err?.message ?? 'erreur inconnue'}` });
    }

    await sendSanctionLog(
      guild,
      new EmbedBuilder()
        .setColor(Colors.join)
        .setAuthor({ name: '🔓 Membre unjail' })
        .setDescription(`${target} (${target.tag})`)
        .addFields(
          ...(rec.hadRole ? [{ name: 'Rôle rendu', value: `<@&${rec.removeRoleId}>`, inline: true }] : []),
          { name: 'Rôle retiré', value: `<@&${rec.addRoleId}>`, inline: true },
          { name: 'Par', value: `${interaction.user}`, inline: true },
        )
        .setTimestamp(),
    );

    return interaction.editReply({
      content: `🔓 ${target} est libéré : ${rec.hadRole ? `il retrouve <@&${rec.removeRoleId}> et` : 'il'} perd <@&${rec.addRoleId}>.`,
    });
  },
};
