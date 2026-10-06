import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getJailConfig, getJailRecord, setJailRecord, removeJailRecord } from '../../lib/store.js';
import { jailRoleProblem } from '../../lib/jail.js';
import { sendSanctionLog, Colors } from '../../lib/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('jail')
    .setDescription('Jail un membre : il perd le rôle configuré et gagne le rôle de jail.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre à jail').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('La raison du jail'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false),

  async execute(interaction) {
    const guild = interaction.guild;
    const target = interaction.options.getUser('membre');
    const reason = interaction.options.getString('raison');

    const config = getJailConfig(guild.id);
    if (!config) return interaction.reply({ content: '❌ Le jail n’est pas configuré. Lance d’abord `/jailconfig`.', ephemeral: true });
    if (getJailRecord(guild.id, target.id)) {
      return interaction.reply({ content: `ℹ️ ${target} est déjà jail (\`/unjail\` pour le libérer).`, ephemeral: true });
    }

    const member = await guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
    if (member.user.bot) return interaction.reply({ content: '❌ Impossible de jail un bot.', ephemeral: true });
    if (member.id === guild.ownerId) return interaction.reply({ content: '❌ Impossible de jail le propriétaire du serveur.', ephemeral: true });
    if (interaction.user.id !== guild.ownerId && member.roles.highest.position >= interaction.member.roles.highest.position) {
      return interaction.reply({ content: '❌ Tu ne peux pas jail un membre dont le rôle est égal ou supérieur au tien.', ephemeral: true });
    }

    const addRole = guild.roles.cache.get(config.addRoleId);
    const removeRole = guild.roles.cache.get(config.removeRoleId);
    const problem = jailRoleProblem(guild, addRole) ?? jailRoleProblem(guild, removeRole);
    if (problem) return interaction.reply({ content: problem, ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    // Enregistré AVANT les changements de rôles : le rôle retiré ne peut plus revenir.
    const hadRole = member.roles.cache.has(removeRole.id);
    setJailRecord(guild.id, member.id, {
      addRoleId: addRole.id,
      removeRoleId: removeRole.id,
      hadRole,
      by: interaction.user.id,
      at: Date.now(),
      reason: reason ?? null,
    });
    const auditReason = `Jail par ${interaction.user.tag}${reason ? ` : ${reason}` : ''}`;
    try {
      await member.roles.add(addRole, auditReason);
      if (hadRole) await member.roles.remove(removeRole, auditReason);
    } catch (err) {
      removeJailRecord(guild.id, member.id);
      await member.roles.remove(addRole).catch(() => {});
      if (hadRole) await member.roles.add(removeRole).catch(() => {});
      return interaction.editReply({ content: `❌ Impossible de jail ce membre : ${err?.message ?? 'erreur inconnue'}` });
    }

    await sendSanctionLog(
      guild,
      new EmbedBuilder()
        .setColor(Colors.delete)
        .setAuthor({ name: '⛓️ Membre jail' })
        .setDescription(`${target} (${target.tag})`)
        .addFields(
          { name: 'Rôle retiré', value: hadRole ? `${removeRole}` : `${removeRole} (ne l’avait pas)`, inline: true },
          { name: 'Rôle donné', value: `${addRole}`, inline: true },
          { name: 'Raison', value: reason || 'Aucune raison précisée' },
          { name: 'Par', value: `${interaction.user}`, inline: true },
        )
        .setTimestamp(),
    );

    return interaction.editReply({
      content:
        `⛓️ ${target} est jail : ${hadRole ? `il perd ${removeRole} et` : `il n’avait pas ${removeRole},`} il gagne ${addRole}.` +
        (reason ? `\nRaison : ${reason}` : ''),
    });
  },
};
