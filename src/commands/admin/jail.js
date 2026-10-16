import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getJailConfig, getJailRecord } from '../../lib/store.js';
import { jailRoleProblem, jailMember } from '../../lib/jail.js';

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

    const problem =
      jailRoleProblem(guild, guild.roles.cache.get(config.addRoleId)) ??
      jailRoleProblem(guild, guild.roles.cache.get(config.removeRoleId));
    if (problem) return interaction.reply({ content: problem, ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    const res = await jailMember(member, { by: interaction.user, reason: reason ?? null });
    if (res.error) return interaction.editReply({ content: res.error });
    const { addRole, removeRole, hadRole, ticketChannel } = res;

    return interaction.editReply({
      content:
        `⛓️ ${target} est jail : ${hadRole ? `il perd ${removeRole} et` : `il n’avait pas ${removeRole},`} il gagne ${addRole}.` +
        (reason ? `\nRaison : ${reason}` : '') +
        (ticketChannel
          ? `\n📣 Mentionné dans ${ticketChannel}.`
          : '\n⚠️ Pas de mention dans le salon des tickets (système 1 non configuré ou salon introuvable).'),
    });
  },
};
