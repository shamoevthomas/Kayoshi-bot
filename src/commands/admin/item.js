import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { addShopItem, getShopItems, getShopItem, updateShopItem, removeShopItem, getTicketConfig } from '../../lib/store.js';
import { formatMoney, ensureShopLogChannel } from '../../lib/shop.js';
import { parseDuration, formatDuration } from '../../lib/time.js';
import { roleCommandProblem } from '../../lib/roles.js';

// Objets de la boutique (/shop) : ajouter, modifier (nom, prix, description) ou retirer.
const TYPES = [
  { name: 'Personnalisé (ouvre un ticket)', value: 'personnalise' },
  { name: 'Rôle permanent', value: 'role' },
  { name: 'Rôle temporaire', value: 'role_temp' },
  { name: 'Booster d’XP', value: 'xp_boost' },
];
const RESET = 'aucune';

const itemOption = (o, description) => o.setName('objet').setDescription(description).setRequired(true).setAutocomplete(true);

export default {
  data: new SlashCommandBuilder()
    .setName('item')
    .setDescription('Objets de la boutique : ajouter, modifier ou retirer.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('ajouter')
        .setDescription('Ajouter un objet à la boutique.')
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
    )
    .addSubcommand((s) =>
      s
        .setName('modifier')
        .setDescription('Modifier le nom, le prix ou la description d’un objet.')
        .addStringOption((o) => itemOption(o, 'L’objet à modifier'))
        .addStringOption((o) => o.setName('nom').setDescription('Nouveau nom').setMaxLength(80))
        .addIntegerOption((o) => o.setName('prix').setDescription('Nouveau prix').setMinValue(0))
        .addStringOption((o) => o.setName('description').setDescription(`Nouvelle description (« ${RESET} » pour la retirer)`).setMaxLength(300)),
    )
    .addSubcommand((s) =>
      s
        .setName('retirer')
        .setDescription('Retirer un objet de la boutique.')
        .addStringOption((o) => itemOption(o, 'L’objet à retirer')),
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    const query = focused.value.toLowerCase();
    if (focused.name === 'motif') {
      const motifs = getTicketConfig(interaction.guild.id, 'ticketConfig')?.motifs ?? [];
      return interaction.respond(
        motifs
          .filter((m) => m.label.toLowerCase().includes(query))
          .slice(0, 25)
          .map((m) => ({ name: m.label.slice(0, 100), value: m.id })),
      );
    }
    await interaction.respond(
      Object.entries(getShopItems(interaction.guild.id))
        .filter(([, it]) => it.name.toLowerCase().includes(query))
        .slice(0, 25)
        .map(([id, it]) => ({ name: `${it.name} (💰 ${formatMoney(it.price)})`.slice(0, 100), value: id })),
    );
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'modifier') return change(interaction);
    if (sub === 'retirer') return remove(interaction);
    return add(interaction);
  },
};

async function add(interaction) {
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
}

async function change(interaction) {
  const itemId = interaction.options.getString('objet', true);
  const item = getShopItem(interaction.guild.id, itemId);
  if (!item) return interaction.reply({ content: '❌ Objet introuvable (choisis-le dans la liste).', ephemeral: true });

  const patch = {};
  const nom = interaction.options.getString('nom')?.trim();
  const prix = interaction.options.getInteger('prix');
  const description = interaction.options.getString('description')?.trim();

  if (nom) patch.name = nom;
  if (prix != null) patch.price = prix;
  if (description) patch.description = description.toLowerCase() === RESET ? null : description;

  if (!Object.keys(patch).length) {
    return interaction.reply({
      content: `ℹ️ **${item.name}** — 💰 ${formatMoney(item.price)}\n${item.description ?? '_Aucune description._'}\n-# Ajoute une option (nom, prix, description) pour le modifier.`,
      ephemeral: true,
    });
  }

  const updated = updateShopItem(interaction.guild.id, itemId, patch);
  const changes = [];
  if (patch.name) changes.push(`• Nom : **${item.name}** → **${updated.name}**`);
  if (patch.price != null) changes.push(`• Prix : 💰 ${formatMoney(item.price)} → 💰 ${formatMoney(updated.price)}`);
  if ('description' in patch) changes.push(`• Description ${updated.description ? 'mise à jour' : 'retirée'}`);

  return interaction.reply({ content: `✅ Objet **${updated.name}** modifié :\n${changes.join('\n')}`, ephemeral: true });
}

async function remove(interaction) {
  const removed = removeShopItem(interaction.guild.id, interaction.options.getString('objet', true));
  if (!removed) return interaction.reply({ content: '❌ Objet introuvable (choisis-le dans la liste).', ephemeral: true });
  await interaction.reply({ content: `🗑️ Objet **${removed.name}** retiré de la boutique.`, ephemeral: true });
}
