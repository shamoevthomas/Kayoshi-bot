import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
} from 'discord.js';
import { getMoney, addMoney, getShopItems, getShopItem, addPurchase, getPurchases, getShopConfig, setTempRole } from './store.js';
import { openTicketFor } from './tickets.js';
import { formatDuration } from './time.js';

// Couleur par défaut de la boutique, et parseur de couleur hex pour /configshop.
const DEFAULT_COLOR = 0x2ecc71;
export function parseColor(input) {
  const h = (input ?? '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(h) ? parseInt(h, 16) : null;
}

// Boutique : objets virtuels achetés avec l'argent gagné en montant de niveau.
// L'état (page + tri) est encodé dans les customId des boutons : shop_* .

const PER_PAGE = 5;
const COIN = '💰';

export const formatMoney = (n) => n.toLocaleString('fr-FR').replace(/[  ]/g, ' ');

const SORTS = {
  prix_asc: { label: 'Prix croissant', cmp: (a, b) => a.price - b.price },
  prix_desc: { label: 'Prix décroissant', cmp: (a, b) => b.price - a.price },
  nom: { label: 'Nom (A→Z)', cmp: (a, b) => a.name.localeCompare(b.name) },
  recent: { label: 'Plus récents', cmp: (a, b) => b.createdAt - a.createdAt },
};

function sortedItems(guildId, sort) {
  const items = Object.entries(getShopItems(guildId)).map(([id, it]) => ({ id, ...it }));
  return items.sort((SORTS[sort] ?? SORTS.prix_asc).cmp);
}

// Construit l'affichage de la boutique pour une page et un tri donnés.
export function shopPayload(guild, userId, { page = 0, sort = 'prix_asc' } = {}) {
  const items = sortedItems(guild.id, sort);
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const current = Math.min(Math.max(0, page), pages - 1);
  const slice = items.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE);
  const balance = getMoney(guild.id, userId);
  const cfg = getShopConfig(guild.id);

  const embed = new EmbedBuilder()
    .setColor(cfg.color ?? DEFAULT_COLOR)
    .setAuthor({ name: cfg.title || `🛒 Boutique — ${guild.name}`, iconURL: guild.iconURL() ?? undefined })
    .setFooter({ text: `Tu as ${formatMoney(balance)} ${COIN}  ·  Tri : ${(SORTS[sort] ?? SORTS.prix_asc).label}` });

  // Description personnalisée (/configshop) affichée en tête, puis la page d'objets.
  const intro = cfg.description ? `${cfg.description}\n\n` : '';
  if (!items.length) {
    embed.setDescription(`${intro}La boutique est vide pour le moment.\n-# Un admin peut ajouter des objets avec \`/add-item\`.`);
    return { embeds: [embed], components: [], allowedMentions: { parse: [] } };
  }

  embed.setDescription(
    intro +
      slice
        .map((it) => `**${it.name}** — ${COIN} **${formatMoney(it.price)}**\n${it.description ?? '*Aucune description.*'}`)
        .join('\n\n'),
  );

  const state = `${current}:${sort}`;
  // Un bouton d'achat par objet de la page (prix affiché), dans une rangée.
  const buyRow = new ActionRowBuilder().addComponents(
    slice.map((it) =>
      new ButtonBuilder()
        .setCustomId(`shop_buy:${it.id}:${state}`)
        .setLabel(`${formatMoney(it.price)} — Acheter`)
        .setStyle(balance >= it.price ? ButtonStyle.Primary : ButtonStyle.Secondary)
        .setEmoji(COIN)
        .setDisabled(balance < it.price),
    ),
  );

  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`shop_page:${current - 1}:${sort}`).setLabel('Précédent').setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
    new ButtonBuilder().setCustomId('shop_noop').setLabel(`Page ${current + 1}/${pages}`).setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId(`shop_page:${current + 1}:${sort}`).setLabel('Suivant').setStyle(ButtonStyle.Secondary).setDisabled(current >= pages - 1),
    new ButtonBuilder().setCustomId(`shop_inv:${state}`).setLabel('Mon inventaire').setStyle(ButtonStyle.Success).setEmoji('🎒'),
  );

  const sortRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`shop_sort:${current}`).setPlaceholder('Trier la boutique').addOptions(
      Object.entries(SORTS).map(([value, s]) => ({ label: s.label, value, default: value === sort })),
    ),
  );

  return { embeds: [embed], components: [buyRow, navRow, sortRow], allowedMentions: { parse: [] } };
}

// Embed de l'inventaire : objets achetés par le membre (regroupés). title = en-tête affiché.
export function inventoryEmbed(guild, userId, title = '🎒 Ton inventaire') {
  const purchases = getPurchases(guild.id, userId);
  const counts = new Map();
  for (const p of purchases) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
  const balance = getMoney(guild.id, userId);
  return new EmbedBuilder()
    .setColor(0x2ecc71)
    .setAuthor({ name: title })
    .setDescription(
      counts.size
        ? [...counts.entries()].map(([name, n]) => `• **${name}**${n > 1 ? ` ×${n}` : ''}`).join('\n')
        : 'Tu n’as encore rien acheté.',
    )
    .setFooter({ text: `Solde : ${formatMoney(balance)} ${COIN}  ·  ${purchases.length} achat(s)` });
}

// --- Achat ---
async function buy(interaction, itemId) {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const item = getShopItem(guildId, itemId);
  if (!item) return interaction.reply({ content: '❌ Cet objet n’existe plus.', ephemeral: true });
  const balance = getMoney(guildId, userId);
  if (balance < item.price) {
    return interaction.reply({
      content: `❌ Il te faut ${COIN} **${formatMoney(item.price)}** pour **${item.name}**, tu as **${formatMoney(balance)}**.`,
      ephemeral: true,
    });
  }
  // Exécute l'effet de l'objet selon son type (ticket / rôle permanent / rôle temporaire).
  const outcome = await fulfill(interaction, item);
  if (outcome.error) return interaction.reply({ content: `❌ ${outcome.error} Rien n’a été débité.`, ephemeral: true });

  const after = addMoney(guildId, userId, -item.price);
  addPurchase(guildId, { userId, itemId, name: item.name, price: item.price, type: item.type ?? 'personnalise' });
  return interaction.reply({
    content:
      `✅ Tu as acheté **${item.name}** pour ${COIN} **${formatMoney(item.price)}** !\n` +
      `Nouveau solde : ${COIN} **${formatMoney(after)}**.\n${outcome.note}`,
    ephemeral: true,
  });
}

// Effet d'un objet acheté. Renvoie { note } en cas de succès, ou { error } (achat annulé).
async function fulfill(interaction, item) {
  const { guild, user } = interaction;
  const type = item.type ?? 'personnalise';

  if (type === 'role' || type === 'role_temp') {
    const role = guild.roles.cache.get(item.roleId);
    if (!role) return { error: 'Le rôle de cet objet n’existe plus (préviens un admin).' };
    const me = guild.members.me;
    if (role.position >= me.roles.highest.position || !me.permissions.has('ManageRoles')) {
      return { error: 'Je ne peux pas donner ce rôle (hiérarchie/permission — préviens un admin).' };
    }
    const member = interaction.member ?? (await guild.members.fetch(user.id).catch(() => null));
    if (!member) return { error: 'Membre introuvable.' };
    const given = await member.roles.add(role, `Achat boutique : ${item.name}`).then(() => true).catch(() => false);
    if (!given) return { error: 'Impossible de te donner le rôle.' };
    if (type === 'role_temp') {
      setTempRole(guild.id, { userId: user.id, roleId: role.id, removeAt: Date.now() + item.durationMs, by: guild.client.user.id });
      return { note: `🎖️ Tu as le rôle ${role} pendant **${formatDuration(item.durationMs)}**.` };
    }
    return { note: `🎖️ Tu as reçu le rôle ${role}.` };
  }

  // personnalisé : ouvre un ticket du système 2 avec le motif choisi.
  const result = await openTicketFor(guild, user, 2, item.motifId);
  if (result.error) return { error: result.error };
  return {
    note: result.already
      ? `🎫 Tu as déjà un ticket ouvert pour ça : ${result.channel}.`
      : `🎫 Un ticket a été ouvert pour ta demande : ${result.channel}.`,
  };
}

// --- Routeur des interactions « shop_ » ---
export async function openShop(interaction) {
  return interaction.reply({ ...shopPayload(interaction.guild, interaction.user.id, {}), ephemeral: true });
}

export async function handleShopInteraction(interaction) {
  const [action, arg, pageStr, sort] = interaction.customId.split(':');

  if (action === 'shop_buy') {
    await buy(interaction, arg);
    // Rafraîchit l'affichage (soldes, boutons) sur le message d'origine.
    return interaction.message
      .edit(shopPayload(interaction.guild, interaction.user.id, { page: Number(pageStr) || 0, sort }))
      .catch(() => {});
  }

  if (action === 'shop_page') {
    return interaction.update(shopPayload(interaction.guild, interaction.user.id, { page: Number(arg) || 0, sort: pageStr }));
  }

  if (action === 'shop_sort') {
    return interaction.update(shopPayload(interaction.guild, interaction.user.id, { page: Number(arg) || 0, sort: interaction.values[0] }));
  }

  if (action === 'shop_inv') {
    return interaction.reply({ embeds: [inventoryEmbed(interaction.guild, interaction.user.id)], ephemeral: true });
  }
}
