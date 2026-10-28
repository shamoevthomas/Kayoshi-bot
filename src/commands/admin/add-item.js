import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { addShopItem, getTicketConfig } from '../../lib/store.js';
import { formatMoney, ensureShopLogChannel } from '../../lib/shop.js';
import { parseDuration, formatDuration } from '../../lib/time.js';
import { roleCommandProblem } from '../../lib/roles.js';

const TYPES = [
  { name: 'Personnalisé (ouvre un ticket)', value: 'personnalise' },
  { name: 'Rôle permanent', value: 'role' },
  { name: 'Rôle temporaire', value: 'role_temp' },
  { name: 'Booster d’XP', value: 'xp_boost' },
];

export default {
  data: new SlashCommandBuilder()
    .setName('add-item')
    .setDescription('Ajouter un objet à la boutique.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption((o) => o.setName('nom').setDescription('Nom de l’objet').setRequired(true).setMaxLength(80))
    .addIntegerOption((o) => o.setName('prix').setDescription('Prix en argent').setRequired(true).setMinValue(0))
    .addStringOption((o) => o.setName('type').setDescription('Type d’objet').setRequired(true).addChoices(...TYPES))
    .addStringOption((o) => o.setName('description').setDescription('Description affichée dans la boutique').setMaxLength(300))
    .addStringOption((o) =>
      o.setName('motif').setDescription('Type « personnalisé » : motif du ticket ouvert à l’achat').setAutocomplete(true),
    )
    .addRoleOption((o) => o.setName('role').setDescription('Type « rôle » : le rôle donné à l’achat'))
    .addStringOption((o) => o.setName('duree').setDescription('Types « rôle temporaire » et « booster d’XP » : durée, ex 1h, 7d, 2 jours'))
    .addIntegerOption((o) =>
      o.setName('multiplicateur').setDescription('Type « booster d’XP » : XP ×2, ×3… (défaut : 2)').setMinValue(2).setMaxValue(5),
    ),

  async autocomplete(interaction) {
    const query = interaction.options.getFocused().toLowerCase();
    const motifs = getTicketConfig(interaction.guild.id, 'ticketConfig')?.motifs ?? [];
    await interaction.respond(
      motifs
        .filter((m) => m.label.toLowerCase().includes(query))
        .slice(0, 25)
        .map((m) => ({ name: m.label.slice(0, 100), value: m.id })),
    );
  },

  async execute(interaction) {
    // Salon « logs-boutique » prêt dès le premier objet.
    ensureShopLogChannel(interaction.guild).catch(() => {});
    const name = interaction.options.getString('nom', true).trim();
    const price = interaction.options.getInteger('prix', true);
    const type = interaction.options.getString('type', true);
    const description = interaction.options.getString('description')?.trim() || null;
    const base = { name, price, description, type };

    if (type === 'personnalise') {
      const motifId = interaction.options.getString('motif');
      const config = getTicketConfig(interaction.guild.id, 'ticketConfig');
      if (!config?.motifs?.length) {
        return interaction.reply({ content: '❌ Le système de tickets n’est pas configuré. Lance `/configticket` d’abord.', ephemeral: true });
      }
      const motif = motifId && config.motifs.find((m) => m.id === motifId);
      if (!motif) return interaction.reply({ content: '❌ Choisis un **motif** dans la liste (option `motif`).', ephemeral: true });
      const item = addShopItem(interaction.guild.id, { ...base, motifId: motif.id });
      return interaction.reply({
        content: `✅ Objet **${item.name}** ajouté (💰 ${formatMoney(price)}) : ouvre un **ticket** avec le motif **${motif.label}** à l’achat.`,
        ephemeral: true,
      });
    }

    // Booster d'XP : XP multipliée pour l'acheteur pendant la durée.
    if (type === 'xp_boost') {
      const dur = parseDuration(interaction.options.getString('duree') ?? '');
      if (!dur || dur.permanent || dur.ms < 60_000 || dur.ms > 30 * 86_400_000) {
        return interaction.reply({ content: '❌ Donne une **durée** valide (option `duree`), ex : `1h`, `1d` (1 min à 30 jours).', ephemeral: true });
      }
      const multiplier = interaction.options.getInteger('multiplicateur') ?? 2;
      const item = addShopItem(interaction.guild.id, { ...base, multiplier, durationMs: dur.ms });
      return interaction.reply({
        content: `✅ Objet **${item.name}** ajouté (💰 ${formatMoney(price)}) : XP ×${multiplier} pendant **${formatDuration(dur.ms)}** à l’achat.`,
        ephemeral: true,
      });
    }

    // role / role_temp
    const role = interaction.options.getRole('role');
    if (!role) return interaction.reply({ content: '❌ Choisis le **rôle** à donner (option `role`).', ephemeral: true });
    const problem = roleCommandProblem(interaction, role, 'donner');
    if (problem) return interaction.reply({ content: problem, ephemeral: true });

    if (type === 'role') {
      const item = addShopItem(interaction.guild.id, { ...base, roleId: role.id });
      return interaction.reply({ content: `✅ Objet **${item.name}** ajouté (💰 ${formatMoney(price)}) : donne le rôle ${role} à l’achat.`, ephemeral: true });
    }

    // role_temp
    const dureeStr = interaction.options.getString('duree');
    const dur = dureeStr ? parseDuration(dureeStr) : null;
    if (!dur || dur.permanent || dur.ms < 60_000) {
      return interaction.reply({ content: '❌ Donne une **durée** valide (option `duree`), ex : `2h`, `7d`, `2 jours` (1 min minimum).', ephemeral: true });
    }
    const item = addShopItem(interaction.guild.id, { ...base, roleId: role.id, durationMs: dur.ms });
    return interaction.reply({
      content: `✅ Objet **${item.name}** ajouté (💰 ${formatMoney(price)}) : donne ${role} pendant **${formatDuration(dur.ms)}** à l’achat.`,
      ephemeral: true,
    });
  },
};
