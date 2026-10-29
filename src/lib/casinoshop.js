import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder } from 'discord.js';
import { getCoins, addCoins, getBank, getCasinoInv, patchCasinoInv, getAllCasinoInv, getHeist, patchHeist } from './store.js';
import { formatMoney } from './shop.js';

// Boutique du casino (.shop, .buy) : des bâtiments qui rapportent de l'argent toutes les 2 h (un exemplaire
// de chaque), l'anti-rob (protection de 3 h contre .rob) et le wagon (débloque .mine et .wagon).
// Payé avec l'argent de la poche. Menu « cshop:<membre> » routé par interactionCreate.
export const BUILDINGS = [
  { id: 'bar', name: 'Bar', emoji: '🍺', price: 2000, gain: 100 },
  { id: 'garage', name: 'Garage', emoji: '🔧', price: 3000, gain: 200 },
  { id: 'magasin', name: 'Magasin', emoji: '🏪', price: 4000, gain: 300 },
  { id: 'cinema', name: 'Cinéma', emoji: '🎬', price: 5000, gain: 400 },
  { id: 'gare', name: 'Gare', emoji: '🚉', price: 6500, gain: 500 },
  { id: 'mairie', name: 'Mairie', emoji: '🏛️', price: 8000, gain: 600 },
];
export const ANTI_ROB = { id: 'anti-rob', name: 'anti-rob', emoji: '🛡️', price: 3000, ms: 3 * 3_600_000 };
export const WAGON = { id: 'wagon', name: 'wagon', emoji: '🛒', price: 1500 };
export const PAYOUT_MS = 2 * 3_600_000;
const RENEW_BEFORE_MS = 3_600_000;
const MAX_MISSED = 12; // après une coupure du bot, au plus 24 h de revenus rattrapés
const ITEMS = [...BUILDINGS, ANTI_ROB, WAGON];
const ts = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

// « Cinéma », « cinema », « antirob », « antivol »… → l'objet.
const normalize = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[\s_-]/g, '');
const ALIASES = { antivol: 'anti-rob', antirob: 'anti-rob' };
export function findItem(query) {
  const q = normalize(query);
  const id = ALIASES[q] ?? q;
  return ITEMS.find((it) => normalize(it.id) === normalize(id) || normalize(it.name) === q) ?? null;
}

export const buildingIncome = (inv) => BUILDINGS.filter((b) => inv.buildings.includes(b.id)).reduce((n, b) => n + b.gain, 0);

export function shopEmbed(guild, userId) {
  const inv = getCasinoInv(guild.id, userId);
  const owned = (id) => (inv.buildings.includes(id) ? ' ✅' : '');
  const shield = getHeist(guild.id, userId).shield ?? 0;
  const lines = [
    ...BUILDINGS.map((b) => `• ${b.emoji} **${b.name}**${owned(b.id)}\nPrix: ${formatMoney(b.price)}\nGain: ${formatMoney(b.gain)}`),
    `**${ANTI_ROB.emoji} ${ANTI_ROB.name}**${shield > Date.now() ? ` _(actif, fin ${ts(shield)})_` : ''}\nPrix: ${formatMoney(ANTI_ROB.price)}\nDéfini le temps d’anti-rob à 3 heures`,
    `**${WAGON.emoji} ${WAGON.name}**${inv.wagon ? ' ✅' : ''}\nPrix: ${formatMoney(WAGON.price)}\nAccès aux commandes \`mine\` et \`wagon\``,
    '-# Les récompenses des bâtiments sont attribuées toutes les 2 heures',
  ];
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`Voici la boutique du serveur ${guild.name}`)
    .setDescription(lines.join('\n'))
    .setFooter({ text: `Ta poche : ${formatMoney(getCoins(guild.id, userId))} · achète avec le menu ou .buy <objet>` });
}

export function shopMenu(guild, userId) {
  const inv = getCasinoInv(guild.id, userId);
  const options = ITEMS.filter((it) => !inv.buildings.includes(it.id) && !(it === WAGON && inv.wagon)).map((it) => ({
    label: `${it.name[0].toUpperCase()}${it.name.slice(1)} — ${formatMoney(it.price)}`,
    value: it.id,
    emoji: it.emoji,
    description: it.gain ? `Rapporte ${formatMoney(it.gain)} toutes les 2 h` : it === ANTI_ROB ? 'Protection contre .rob pendant 3 h' : 'Débloque .mine et .wagon',
  }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(`cshop:${userId}`).setPlaceholder('🛒 Acheter…').addOptions(options),
  );
}

// Achète un objet pour userId. Renvoie { ok, text }.
export function buyItem(guild, userId, item) {
  const inv = getCasinoInv(guild.id, userId);
  const pocket = getCoins(guild.id, userId);
  if (inv.buildings.includes(item.id)) return { ok: false, text: `❌ Tu as déjà un **${item.name}**.` };
  if (item === WAGON && inv.wagon) return { ok: false, text: '❌ Tu as déjà un wagon.' };
  const shield = getHeist(guild.id, userId).shield ?? 0;
  // Racheter l'anti-rob le remet à 3 h : seulement quand il reste moins d'1 h (sinon on paie pour presque rien).
  if (item === ANTI_ROB && shield - Date.now() > RENEW_BEFORE_MS) {
    return { ok: false, text: `🛡️ Ton anti-rob est déjà actif jusqu’à ${ts(shield)}. Tu pourras le racheter quand il restera moins d’1 h.` };
  }
  if (pocket < item.price) {
    const bank = getBank(guild.id, userId);
    return { ok: false, text: `❌ **${item.name}** coûte 🪙 **${formatMoney(item.price)}**, tu as 🪙 **${formatMoney(pocket)}** en poche.${bank ? ` (🪙 ${formatMoney(bank)} à la banque : \`.with\`)` : ''}` };
  }
  addCoins(guild.id, userId, -item.price);
  if (item === ANTI_ROB) {
    patchHeist(guild.id, userId, { shield: Date.now() + ANTI_ROB.ms });
    return { ok: true, text: `🛡️ Anti-rob acheté (🪙 ${formatMoney(item.price)}) : personne ne peut te voler jusqu’à ${ts(Date.now() + ANTI_ROB.ms)}.` };
  }
  if (item === WAGON) {
    patchCasinoInv(guild.id, userId, { wagon: true });
    return { ok: true, text: `🛒 Wagon acheté (🪙 ${formatMoney(item.price)}) : \`.mine\` remplit ton wagon de minerais, \`.wagon\` les revend.` };
  }
  // Premier bâtiment : premier revenu dans 2 h. Les suivants s'ajoutent au même rythme.
  patchCasinoInv(guild.id, userId, { buildings: [...inv.buildings, item.id], lastPayout: inv.lastPayout ?? Date.now() });
  const income = buildingIncome(getCasinoInv(guild.id, userId));
  return { ok: true, text: `${item.emoji} **${item.name}** acheté (🪙 ${formatMoney(item.price)}) ! Tes bâtiments rapportent maintenant 🪙 **${formatMoney(income)}** toutes les 2 h.` };
}

export async function shop(interaction) {
  const { guild, user } = interaction;
  return interaction.reply({ embeds: [shopEmbed(guild, user.id)], components: [shopMenu(guild, user.id)], allowedMentions: { parse: [] } });
}

// .buy <objet>
export async function buy(interaction) {
  const { guild, user } = interaction;
  const query = interaction.options.getString('objet');
  const item = findItem(query);
  if (!item) return interaction.reply({ content: `❌ Objet inconnu${query ? ` : « ${query} »` : ''}. Regarde la boutique avec \`.shop\`.`, ephemeral: true });
  return interaction.reply({ content: buyItem(guild, user.id, item).text, allowedMentions: { parse: [] } });
}

export async function handleCasinoShopInteraction(interaction) {
  const userId = interaction.customId.split(':')[1];
  if (interaction.user.id !== userId) return interaction.reply({ content: '❌ Ouvre ta propre boutique avec `.shop`.', ephemeral: true });
  const item = findItem(interaction.values[0]);
  const result = item ? buyItem(interaction.guild, userId, item) : { text: '❌ Objet inconnu.' };
  await interaction.update({ embeds: [shopEmbed(interaction.guild, userId)], components: [shopMenu(interaction.guild, userId)] });
  return interaction.followUp({ content: result.text, ephemeral: true });
}

// Chaque minute : verse les revenus des bâtiments (toutes les 2 h depuis le dernier versement).
export function buildingsTick(client) {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    for (const [userId, inv] of Object.entries(getAllCasinoInv(guild.id))) {
      if (!inv.buildings?.length || !inv.lastPayout) continue;
      const periods = Math.floor((now - inv.lastPayout) / PAYOUT_MS);
      if (periods < 1) continue;
      const income = buildingIncome({ buildings: inv.buildings });
      addCoins(guild.id, userId, income * Math.min(periods, MAX_MISSED));
      patchCasinoInv(guild.id, userId, { lastPayout: inv.lastPayout + periods * PAYOUT_MS });
    }
  }
}
