import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getTicketConfig, setTicketConfig } from '../../lib/store.js';
import { revokeStaffRoleAccess } from '../../lib/tickets.js';

const slotKey = (slot) => (slot === 2 ? 'ticketConfig2' : 'ticketConfig');
const cfgCmd = (slot) => (slot === 2 ? 'configticket2' : 'configticket');

// Retire un rôle du staff global des tickets : il perd l'accès aux salons de
// tickets qui utilisent le staff global et n'est plus mentionné à l'ouverture.
export default {
  data: new SlashCommandBuilder()
    .setName('retirerroleticket')
    .setDescription('Retirer un rôle du staff des tickets (accès + mention à l’ouverture).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addRoleOption((o) => o.setName('role').setDescription('Le rôle à retirer du staff des tickets').setRequired(true))
    .addIntegerOption((o) =>
      o
        .setName('systeme')
        .setDescription('Système de tickets concerné (1 par défaut)')
        .addChoices({ name: 'Système 1', value: 1 }, { name: 'Système 2', value: 2 }),
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

    const role = interaction.options.getRole('role');
    const idx = (config.staffRoleIds ?? []).indexOf(role.id);
    if (idx === -1) {
      return interaction.reply({ content: `ℹ️ ${role} ne fait pas partie du staff des tickets${slot === 2 ? ' (système 2)' : ''}.`, ephemeral: true });
    }

    config.staffRoleIds.splice(idx, 1);
    setTicketConfig(interaction.guild.id, config, key);

    await interaction.deferReply({ ephemeral: true });
    await revokeStaffRoleAccess(interaction.guild, config, role.id);
    const warn = config.staffRoleIds.length === 0
      ? '\n⚠️ Il ne reste plus aucun rôle staff global : seuls les membres avec la permission **Gérer les salons** verront ces tickets.'
      : '';
    return interaction.editReply({
      content: `✅ ${role} a été retiré du staff des tickets${slot === 2 ? ' (système 2)' : ''}.${warn}`,
    });
  },
};
