import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getTicketConfig, setTicketConfig } from '../../lib/store.js';
import { grantStaffRoleAccess } from '../../lib/tickets.js';

const slotKey = (slot) => (slot === 2 ? 'ticketConfig2' : 'ticketConfig');
const cfgCmd = (slot) => (slot === 2 ? 'configticket2' : 'configticket');

// Ajoute un rôle au staff global des tickets : il gagne l'accès aux salons de
// tickets (catégories + tickets déjà ouverts) et est mentionné à l'ouverture des
// nouveaux tickets qui utilisent le staff global.
export default {
  data: new SlashCommandBuilder()
    .setName('ajouterroleticket')
    .setDescription('Ajouter un rôle qui voit les tickets et est mentionné dès leur ouverture.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addRoleOption((o) => o.setName('role').setDescription('Le rôle à ajouter au staff des tickets').setRequired(true))
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
    if (role.id === interaction.guild.id) {
      return interaction.reply({ content: '❌ Impossible d’utiliser @everyone.', ephemeral: true });
    }

    config.staffRoleIds = config.staffRoleIds ?? [];
    if (config.staffRoleIds.includes(role.id)) {
      return interaction.reply({ content: `ℹ️ ${role} fait déjà partie du staff des tickets${slot === 2 ? ' (système 2)' : ''}.`, ephemeral: true });
    }

    config.staffRoleIds.push(role.id);
    setTicketConfig(interaction.guild.id, config, key);

    await interaction.deferReply({ ephemeral: true });
    await grantStaffRoleAccess(interaction.guild, config, role.id);
    return interaction.editReply({
      content:
        `✅ ${role} a désormais accès aux tickets${slot === 2 ? ' (système 2)' : ''} et sera **mentionné** à l’ouverture des nouveaux tickets.\n` +
        `_(N'affecte pas les catégories qui ont leurs propres rôles d'accès.)_`,
    });
  },
};
