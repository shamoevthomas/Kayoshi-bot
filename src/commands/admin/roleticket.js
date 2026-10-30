import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getTicketConfig, setTicketConfig } from '../../lib/store.js';
import { grantStaffRoleAccess, revokeStaffRoleAccess } from '../../lib/tickets.js';

const slotKey = (slot) => (slot === 2 ? 'ticketConfig2' : 'ticketConfig');
const cfgCmd = (slot) => (slot === 2 ? 'configticket2' : 'configticket');

// Staff global des tickets : un rôle ajouté gagne l'accès aux salons de tickets (catégories +
// tickets déjà ouverts) et est mentionné à l'ouverture des nouveaux tickets ; un rôle retiré
// perd cet accès et n'est plus mentionné.
export default {
  data: new SlashCommandBuilder()
    .setName('roleticket')
    .setDescription('Rôles qui voient les tickets et sont mentionnés dès leur ouverture.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('ajouter')
        .setDescription('Ajouter un rôle au staff des tickets (accès + mention à l’ouverture).')
        .addRoleOption((o) => o.setName('role').setDescription('Le rôle à ajouter au staff des tickets').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('retirer')
        .setDescription('Retirer un rôle du staff des tickets.')
        .addRoleOption((o) => o.setName('role').setDescription('Le rôle à retirer du staff des tickets').setRequired(true)),
    ),

  async execute(interaction) {
    const slot = interaction.options.getInteger('systeme') ?? 1;
    const key = slotKey(slot);
    const config = getTicketConfig(interaction.guild.id, key);
    if (!config) {
      return interaction.reply({
        content: `❌ Le système de tickets ${slot === 2 ? '2 ' : ''}n'est pas configuré. Lance d'abord \`/${cfgCmd(slot)}\`.`,
        ephemeral: true,
      });
    }
    const role = interaction.options.getRole('role', true);
    const system = slot === 2 ? ' (système 2)' : '';
    config.staffRoleIds = config.staffRoleIds ?? [];

    if (interaction.options.getSubcommand() === 'retirer') {
      const idx = config.staffRoleIds.indexOf(role.id);
      if (idx === -1) return interaction.reply({ content: `ℹ️ ${role} ne fait pas partie du staff des tickets${system}.`, ephemeral: true });
      config.staffRoleIds.splice(idx, 1);
      setTicketConfig(interaction.guild.id, config, key);

      await interaction.deferReply({ ephemeral: true });
      await revokeStaffRoleAccess(interaction.guild, config, role.id);
      const warn = config.staffRoleIds.length === 0
        ? '\n⚠️ Il ne reste plus aucun rôle staff global : seuls les membres avec la permission **Gérer les salons** verront ces tickets.'
        : '';
      return interaction.editReply({ content: `✅ ${role} a été retiré du staff des tickets${system}.${warn}` });
    }

    if (role.id === interaction.guild.id) {
      return interaction.reply({ content: '❌ Impossible d’utiliser @everyone.', ephemeral: true });
    }
    if (config.staffRoleIds.includes(role.id)) {
      return interaction.reply({ content: `ℹ️ ${role} fait déjà partie du staff des tickets${system}.`, ephemeral: true });
    }
    config.staffRoleIds.push(role.id);
    setTicketConfig(interaction.guild.id, config, key);

    await interaction.deferReply({ ephemeral: true });
    await grantStaffRoleAccess(interaction.guild, config, role.id);
    return interaction.editReply({
      content:
        `✅ ${role} a désormais accès aux tickets${system} et sera **mentionné** à l’ouverture des nouveaux tickets.\n` +
        `_(N'affecte pas les catégories qui ont leurs propres rôles d'accès.)_`,
    });
  },
};
