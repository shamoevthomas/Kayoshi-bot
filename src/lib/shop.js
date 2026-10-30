import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  EmbedBuilder,
  MessageFlags,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
} from 'discord.js';
import { getMoney, addMoney, getShopItems, getShopItem, addPurchase, getPurchases, getShopConfig, setTempRole, getXpBoost, setXpBoost } from './store.js';
import { openTicketFor } from './tickets.js';
import { formatDuration } from './time.js';
import { ensureExtraLogChannel } from './logger.js';

// Couleur par défaut de la boutique, et parseur de couleur hex pour /configshop.
const DEFAULT_COLOR = 0x2ecc71;
export function parseColor(input) {
  const h = (input ?? '').trim().replace(/^#/, '');
  return /^[0-9a-fA-F]{6}$/.test(h) ? parseInt(h, 16) : null;
}

// Boutique : objets virtuels achetés avec l'argent gagné en montant de niveau.
// L'état (page + tri) est encodé dans les customId des boutons : shop_* .

const PER_PAGE = 7;
const COIN = '💰';

export const formatMoney = (n) => n.toLocaleString('fr-FR').replace(/[  ]/g, ' ');

const SORTS = {
  prix_asc: { label: 'Prix croissant', cmp: (a, b) => a.price - b.price },
  prix_desc: { label: 'Prix décroissant', cmp: (a, b) => b.price - a.price },
  nom: { label: 'Nom (A→Z)', cmp: (a, b) => a.name.localeCompare(b.name) },
  recent: { label: 'Plus récents', cmp: (a, b) => b.createdAt - a.createdAt },
};

// Promo du jour : chaque jour (heure de Paris), un objet tiré au hasard coûte 10 % de moins.
// Tirage déterministe (même objet toute la journée, sans rien stocker), qui change à minuit.
export const PROMO_PERCENT = 10;
const parisDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
function hash(text) {
  let h = 0;
  for (const c of text) h = (Math.imul(h, 31) + c.codePointAt(0)) >>> 0;
  return h;
}
export function promoItemId(guildId, now = Date.now()) {
  const ids = Object.keys(getShopItems(guildId)).sort();
  return ids.length ? ids[hash(`${guildId}:${parisDay.format(new Date(now))}`) % ids.length] : null;
}
// Prix payé : réduit pour l'objet en promo du jour.
export function itemPrice(guildId, itemId, item) {
  return itemId === promoItemId(guildId) ? Math.round((item.price * (100 - PROMO_PERCENT)) / 100) : item.price;
}

function sortedItems(guildId, sort) {
  const promo = promoItemId(guildId);
  // price = prix payé (promo comprise), basePrice = prix normal.
  const items = Object.entries(getShopItems(guildId)).map(([id, it]) => ({
    id,
    ...it,
    basePrice: it.price,
    price: itemPrice(guildId, id, it),
    promo: id === promo,
  }));
  return items.sort((SORTS[sort] ?? SORTS.prix_asc).cmp);
}

// Construit l'affichage de la boutique (Components V2 : bouton d'achat à droite de chaque objet).
export function shopPayload(guild, userId, { page = 0, sort = 'prix_asc' } = {}) {
  const items = sortedItems(guild.id, sort);
  const pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
  const current = Math.min(Math.max(0, page), pages - 1);
  const slice = items.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE);
  const balance = getMoney(guild.id, userId);
  const cfg = getShopConfig(guild.id);
  const title = cfg.title || `🛒 Boutique — ${guild.name}`;

  const container = new ContainerBuilder().setAccentColor(cfg.color ?? DEFAULT_COLOR);
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${title}${cfg.description ? `\n${cfg.description}` : ''}`));
  container.addSeparatorComponents(new SeparatorBuilder());

  if (!items.length) {
    container.addTextDisplayComponents(
      new TextDisplayBuilder().setContent('La boutique est vide pour le moment.\n-# Un admin peut ajouter des objets avec `/item ajouter`.'),
    );
    return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
  }

  const state = `${current}:${sort}`;
  // Chaque objet = une section : texte à gauche, bouton « Acheter » à droite (comme Draftbot).
  for (const it of slice) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(
          new TextDisplayBuilder().setContent(
            (it.promo ? `🏷️ **Promo du jour : -${PROMO_PERCENT} %** (au lieu de ~~${formatMoney(it.basePrice)}~~)\n` : '') +
              (it.description ? `**${it.name}**\n${it.description}` : `**${it.name}**`),
          ),
        )
        .setButtonAccessory(
          new ButtonBuilder()
            .setCustomId(`shop_buy:${it.id}:${state}`)
            .setLabel(`${formatMoney(it.price)} — Acheter`)
            .setStyle(balance >= it.price ? ButtonStyle.Primary : ButtonStyle.Secondary)
            .setEmoji(COIN)
            .setDisabled(balance < it.price),
        ),
    );
  }

  container.addSeparatorComponents(new SeparatorBuilder());
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent(
      `Tu as ${COIN} **${formatMoney(balance)}**  ·  Tri : ${(SORTS[sort] ?? SORTS.prix_asc).label}  ·  Page ${current + 1}/${pages}`,
    ),
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`shop_page:${current - 1}:${sort}`).setLabel('Précédent').setStyle(ButtonStyle.Secondary).setDisabled(current === 0),
      new ButtonBuilder().setCustomId(`shop_page:${current + 1}:${sort}`).setLabel('Suivant').setStyle(ButtonStyle.Secondary).setDisabled(current >= pages - 1),
      new ButtonBuilder().setCustomId(`shop_inv:${state}`).setLabel('Mon inventaire').setStyle(ButtonStyle.Success).setEmoji('🎒'),
    ),
  );
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(`shop_sort:${current}`)
        .setPlaceholder('Trier la boutique')
        .addOptions(Object.entries(SORTS).map(([value, s]) => ({ label: s.label, value, default: value === sort }))),
    ),
  );

  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
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

// --- Logs des achats : salon « logs-boutique », créé à côté du salon de logs du serveur ---
const TYPE_LABELS = { personnalise: 'Personnalisé (ticket)', role: 'Rôle permanent', role_temp: 'Rôle temporaire', xp_boost: 'Booster d’XP' };

export const ensureShopLogChannel = (guild) =>
  ensureExtraLogChannel(guild, { name: 'logs-boutique', topic: 'Achats de la boutique (/shop) — Kayoshi.', configKey: 'shopLogChannelId' });

async function logPurchase(interaction, item, price, balance, effect) {
  const { guild, user } = interaction;
  const channel = await ensureShopLogChannel(guild);
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setColor(DEFAULT_COLOR)
    .setAuthor({ name: '🛒 Achat dans la boutique', iconURL: user.displayAvatarURL() })
    .setDescription(`${user} (${user.username}) a acheté **${item.name}**`)
    .addFields(
      { name: 'Prix', value: `${COIN} ${formatMoney(price)}${price < item.price ? ` _(promo du jour, au lieu de ${formatMoney(item.price)})_` : ''}`, inline: true },
      { name: 'Type', value: TYPE_LABELS[item.type ?? 'personnalise'] ?? item.type, inline: true },
      { name: 'Solde après', value: `${COIN} ${formatMoney(balance)}`, inline: true },
      { name: 'Effet', value: effect },
    )
    .setFooter({ text: `ID : ${user.id}` })
    .setTimestamp();
  await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
}

// --- Achat --- Renvoie le message à afficher (ne répond pas lui-même).
async function buy(interaction, itemId) {
  const guildId = interaction.guild.id;
  const userId = interaction.user.id;
  const item = getShopItem(guildId, itemId);
  if (!item) return '❌ Cet objet n’existe plus.';
  const price = itemPrice(guildId, itemId, item); // promo du jour comprise
  const balance = getMoney(guildId, userId);
  if (balance < price) {
    return `❌ Il te faut ${COIN} **${formatMoney(price)}** pour **${item.name}**, tu as **${formatMoney(balance)}**.`;
  }
  // Exécute l'effet de l'objet selon son type (ticket / rôle permanent / rôle temporaire / booster d'XP).
  const outcome = await fulfill(interaction, item);
  if (outcome.error) return `❌ ${outcome.error} Rien n’a été débité.`;

  const after = addMoney(guildId, userId, -price);
  addPurchase(guildId, { userId, itemId, name: item.name, price, type: item.type ?? 'personnalise' });
  // En arrière-plan : la boutique doit être rafraîchie dans les 3 s du clic.
  logPurchase(interaction, item, price, after, outcome.log).catch((err) => console.error('[logs-boutique]', err));
  return (
    `✅ Tu as acheté **${item.name}** pour ${COIN} **${formatMoney(price)}**${price < item.price ? ` (promo du jour -${PROMO_PERCENT} %)` : ''} !\n` +
    `Nouveau solde : ${COIN} **${formatMoney(after)}**.\n${outcome.note}`
  );
}

// Effet d'un objet acheté. Renvoie { note } en cas de succès, ou { error } (achat annulé).
async function fulfill(interaction, item) {
  const { guild, user } = interaction;
  const type = item.type ?? 'personnalise';

  // Booster d'XP : s'ajoute au temps restant d'un booster en cours ; le plus fort multiplicateur est gardé.
  if (type === 'xp_boost') {
    const now = Date.now();
    const current = getXpBoost(guild.id, user.id);
    const active = current?.endsAt > now ? current : null;
    const boost = { multiplier: Math.max(item.multiplier ?? 2, active?.multiplier ?? 1), endsAt: (active?.endsAt ?? now) + item.durationMs };
    setXpBoost(guild.id, user.id, boost);
    const end = Math.floor(boost.endsAt / 1000);
    return {
      note: `⚡ XP ×${boost.multiplier} jusqu’à <t:${end}:t> (<t:${end}:R>).${active ? ' Le temps s’ajoute à ton booster en cours.' : ''}`,
      log: `⚡ XP ×${boost.multiplier} jusqu’à <t:${end}:f>${active ? ' (ajouté au booster en cours)' : ''}`,
    };
  }

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
      const end = Math.floor((Date.now() + item.durationMs) / 1000);
      return {
        note: `🎖️ Tu as le rôle ${role} pendant **${formatDuration(item.durationMs)}**.`,
        log: `🎖️ Rôle ${role} donné pour ${formatDuration(item.durationMs)} (retiré <t:${end}:f>)`,
      };
    }
    return { note: `🎖️ Tu as reçu le rôle ${role}.`, log: `🎖️ Rôle ${role} donné` };
  }

  // personnalisé : ouvre un ticket (système 1) avec le motif choisi.
  const result = await openTicketFor(guild, user, 1, item.motifId);
  if (result.error) return { error: result.error };
  return {
    note: result.already
      ? `🎫 Tu as déjà un ticket ouvert pour ça : ${result.channel}.`
      : `🎫 Un ticket a été ouvert pour ta demande : ${result.channel}.`,
    log: `🎫 À livrer par le staff — ticket ${result.already ? 'déjà ouvert' : 'ouvert'} : ${result.channel}`,
  };
}

// --- Routeur des interactions « shop_ » ---
// La boutique est un message Components V2 (flag requis à chaque envoi/modification).
export async function openShop(interaction) {
  const payload = shopPayload(interaction.guild, interaction.user.id, {});
  return interaction.reply({ ...payload, flags: payload.flags | MessageFlags.Ephemeral });
}

export async function handleShopInteraction(interaction) {
  const [action, arg, pageStr, sort] = interaction.customId.split(':');

  if (action === 'shop_buy') {
    // Achète, rafraîchit la boutique (soldes, boutons), puis confirme à part.
    const note = await buy(interaction, arg);
    await interaction.update(shopPayload(interaction.guild, interaction.user.id, { page: Number(pageStr) || 0, sort })).catch(() => {});
    return interaction.followUp({ content: note, ephemeral: true }).catch(() => {});
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
