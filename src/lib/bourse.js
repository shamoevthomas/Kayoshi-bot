import { EmbedBuilder } from 'discord.js';
import { getCoins, addCoins, getMarket, setMarket, getStocks, setStocks } from './store.js';
import { parseAmount } from './economy.js';
import { formatMoney } from './shop.js';

// Bourse du casino (.bourse) : des actions fictives dont le cours change toutes les heures (au hasard, avec un
// lent retour vers leur prix de base, et parfois une grosse nouvelle qui le fait bondir ou chuter). On les achète
// avec les coins de sa poche et on les revend (frais de 2 %) ; elles sont à l'abri des vols.
// Le marché d'un serveur s'ouvre au premier .bourse ; marketTick (chaque minute) avance les cours d'heure en heure.
export const STOCKS = [
  { id: 'saku', emoji: '🌸', name: 'Sakura Tech', base: 120, vol: 0.03 },
  { id: 'ramn', emoji: '🍜', name: 'Ramen Express', base: 40, vol: 0.025 },
  { id: 'pixl', emoji: '🎮', name: 'Pixel Games', base: 150, vol: 0.045 },
  { id: 'minr', emoji: '⛏️', name: 'Mines Dorées', base: 80, vol: 0.04 },
  { id: 'orbt', emoji: '🚀', name: 'Orbital Space', base: 300, vol: 0.06 },
  { id: 'kayo', emoji: '🪙', name: 'KayoCoin', base: 50, vol: 0.09 },
];
export const SELL_FEE = 0.02;
const HISTORY = 25; // 24 h de cours + le cours actuel
const PULL = 0.02; // retour vers le prix de base, par heure
const NEWS_CHANCE = 0.03; // par action et par heure
const HOUR = 3_600_000;
const hourNow = () => Math.floor(Date.now() / HOUR);
const ACTIONS = { acheter: 'buy', achat: 'buy', achete: 'buy', buy: 'buy', vendre: 'sell', vente: 'sell', vend: 'sell', sell: 'sell' };

export const priceOf = (market, id) => Math.max(1, Math.round(market.prices[id]));
const findStock = (raw) => {
  const s = String(raw ?? '').toLowerCase();
  return s ? STOCKS.find((x) => x.id === s || x.name.toLowerCase().replace(/\s/g, '').startsWith(s)) ?? null : null;
};

// Marché du serveur, ouvert au premier usage (les actions ajoutées plus tard partent de leur prix de base).
function market(guildId) {
  const m = getMarket(guildId);
  if (m && STOCKS.every((s) => m.prices[s.id])) return m;
  const next = structuredClone(m ?? { hour: hourNow(), prices: {}, history: {}, news: [] });
  for (const s of STOCKS) {
    next.prices[s.id] ??= s.base;
    next.history[s.id] ??= [s.base];
  }
  return setMarket(guildId, next);
}

const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

// Une heure de marché : chaque cours bouge au hasard (log-normal) en revenant doucement vers sa base.
function step(m) {
  for (const s of STOCKS) {
    let log = Math.log(m.prices[s.id]);
    log += PULL * (Math.log(s.base) - log) + s.vol * gauss();
    if (Math.random() < NEWS_CHANCE) {
      const up = Math.random() < 0.5;
      const pct = Math.round(10 + Math.random() * 15);
      log += Math.log(up ? 1 + pct / 100 : 1 - pct / 100);
      m.news = [{ at: Date.now(), id: s.id, up, pct }, ...(m.news ?? [])].slice(0, 3);
    }
    m.prices[s.id] = Math.min(s.base * 20, Math.max(1, Math.exp(log)));
    m.history[s.id] = [...m.history[s.id], m.prices[s.id]].slice(-HISTORY);
  }
}

// Chaque minute (ready.js) : avance les marchés ouverts jusqu'à l'heure actuelle (24 h max après un arrêt).
export function marketTick(client) {
  const now = hourNow();
  for (const guildId of client.guilds.cache.keys()) {
    const m = getMarket(guildId);
    if (!m || m.hour >= now) continue;
    const next = structuredClone(market(guildId));
    for (let i = 0; i < Math.min(24, now - m.hour); i++) step(next);
    next.hour = now;
    setMarket(guildId, next);
  }
}

const pct = (a, b) => (b ? (a / b - 1) * 100 : 0);
const pctText = (v) => `${v >= 0 ? '🟢 +' : '🔴 -'}${Math.abs(v).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
const BARS = '▁▂▃▄▅▆▇█';
const spark = (list) => {
  const values = list.slice(-12);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return values.map((v) => BARS[hi === lo ? 3 : Math.round(((v - lo) / (hi - lo)) * 7)]).join('');
};

function marketView(guildId, user) {
  const m = market(guildId);
  const lines = STOCKS.map((s) => {
    const h = m.history[s.id];
    const now = m.prices[s.id];
    const day = h.length >= HISTORY ? '24 h' : 'ouverture';
    return (
      `${s.emoji} **${s.id.toUpperCase()}** · ${s.name} — 🪙 **${formatMoney(priceOf(m, s.id))}**\n` +
      `└ \`${spark(h)}\` 1 h ${h.length > 1 ? pctText(pct(now, h.at(-2))) : '—'} · ${day} ${pctText(pct(now, h[0]))}`
    );
  });
  const embed = new EmbedBuilder()
    .setColor(0x1abc9c)
    .setTitle('📈 Bourse du casino')
    .setDescription(`Les cours changent toutes les heures (prochain changement <t:${(m.hour + 1) * 3600}:R>).\n\n${lines.join('\n')}`)
    .setFooter({ text: `.bourse acheter saku 10 · .bourse vendre saku all · ${SELL_FEE * 100} % de frais à la vente` });

  const mine = getStocks(guildId, user.id);
  const owned = STOCKS.filter((s) => mine[s.id]?.n);
  if (owned.length) {
    let value = 0;
    let cost = 0;
    const rows = owned.map((s) => {
      const { n, cost: paid } = mine[s.id];
      const v = n * priceOf(m, s.id);
      value += v;
      cost += paid;
      return `${s.emoji} **${n}** ${s.id.toUpperCase()} — 🪙 ${formatMoney(v)} (${pctText(pct(v, paid))})`;
    });
    embed.addFields({ name: `💼 Ton portefeuille : 🪙 ${formatMoney(value)} (${pctText(pct(value, cost))})`, value: rows.join('\n') });
  }
  if (m.news?.length) {
    embed.addFields({
      name: '📰 Dernières nouvelles',
      value: m.news
        .map((n) => {
          const s = STOCKS.find((x) => x.id === n.id);
          return `${n.up ? '📈' : '📉'} ${s?.emoji ?? ''} **${s?.name ?? n.id}** ${n.up ? 's’envole' : 'chute'} (${n.up ? '+' : '-'}${n.pct} %) <t:${Math.floor(n.at / 1000)}:R>`;
        })
        .join('\n'),
    });
  }
  return { embeds: [embed], allowedMentions: { parse: [] } };
}

async function buyStock(interaction, stock, raw) {
  const { guild, user } = interaction;
  const m = market(guild.id);
  const price = priceOf(m, stock.id);
  const pocket = getCoins(guild.id, user.id);
  const max = Math.floor(pocket / price);
  const id = stock.id.toUpperCase();
  const n = parseAmount(raw ?? '', max);
  if (n === null) return interaction.reply({ content: `❌ Indique le nombre d’actions : \`.bourse acheter ${stock.id} 10\` (ou \`all\`).`, ephemeral: true });
  if (max < 1) return interaction.reply({ content: `❌ Une action ${id} coûte 🪙 **${formatMoney(price)}** : tu n’as que 🪙 **${formatMoney(pocket)}** en poche.`, ephemeral: true });
  if (n < 1) return interaction.reply({ content: '❌ Achète au moins une action.', ephemeral: true });
  if (n > max) {
    return interaction.reply({
      content: `❌ ${formatMoney(n)} actions ${id} coûtent 🪙 **${formatMoney(n * price)}** : tu n’as que 🪙 **${formatMoney(pocket)}** en poche (${formatMoney(max)} actions au plus).`,
      ephemeral: true,
    });
  }
  const cost = n * price;
  addCoins(guild.id, user.id, -cost);
  const mine = getStocks(guild.id, user.id);
  const cur = mine[stock.id] ?? { n: 0, cost: 0 };
  setStocks(guild.id, user.id, { ...mine, [stock.id]: { n: cur.n + n, cost: cur.cost + cost } });
  return interaction.reply({
    content:
      `📈 Tu achètes **${formatMoney(n)}** action(s) ${stock.emoji} **${id}** à 🪙 **${formatMoney(price)}** : 🪙 **-${formatMoney(cost)}**.\n` +
      `-# Tu en as ${formatMoney(cur.n + n)} · poche : 🪙 ${formatMoney(getCoins(guild.id, user.id))}`,
    allowedMentions: { parse: [] },
  });
}

async function sellStock(interaction, stock, raw) {
  const { guild, user } = interaction;
  const mine = getStocks(guild.id, user.id);
  const cur = mine[stock.id];
  const id = stock.id.toUpperCase();
  if (!cur?.n) return interaction.reply({ content: `❌ Tu n’as pas d’action ${stock.emoji} ${id}.`, ephemeral: true });
  const n = parseAmount(raw ?? 'all', cur.n);
  if (n === null || n < 1) return interaction.reply({ content: `❌ Indique le nombre d’actions : \`.bourse vendre ${stock.id} 10\` (ou \`all\`).`, ephemeral: true });
  if (n > cur.n) return interaction.reply({ content: `❌ Tu n’as que **${formatMoney(cur.n)}** action(s) ${id}.`, ephemeral: true });
  const price = priceOf(market(guild.id), stock.id);
  const gross = n * price;
  const net = Math.floor(gross * (1 - SELL_FEE));
  const paid = Math.round((cur.cost * n) / cur.n);
  addCoins(guild.id, user.id, net);
  const next = { ...mine };
  if (n === cur.n) delete next[stock.id];
  else next[stock.id] = { n: cur.n - n, cost: cur.cost - paid };
  setStocks(guild.id, user.id, next);
  const profit = net - paid;
  return interaction.reply({
    content:
      `💰 Tu vends **${formatMoney(n)}** action(s) ${stock.emoji} **${id}** à 🪙 **${formatMoney(price)}** : 🪙 **+${formatMoney(net)}** (frais : ${formatMoney(gross - net)}).\n` +
      `${profit >= 0 ? '✅ Bénéfice' : '❌ Perte'} : 🪙 **${profit >= 0 ? '+' : '-'}${formatMoney(Math.abs(profit))}** · poche : 🪙 ${formatMoney(getCoins(guild.id, user.id))}`,
    allowedMentions: { parse: [] },
  });
}

// .bourse : les cours et son portefeuille · .bourse acheter|vendre <action> <nombre|all>.
export async function bourse(interaction) {
  const action = ACTIONS[(interaction.options.getString('action') ?? '').toLowerCase()];
  if (!action) return interaction.reply(marketView(interaction.guild.id, interaction.user));
  const stock = findStock(interaction.options.getString('titre'));
  if (!stock) {
    return interaction.reply({
      content: `❌ Choisis une action : ${STOCKS.map((s) => `${s.emoji} \`${s.id}\``).join(', ')} — ex : \`.bourse ${action === 'buy' ? 'acheter' : 'vendre'} saku 10\`.`,
      ephemeral: true,
    });
  }
  const raw = interaction.options.getString('nombre');
  return action === 'buy' ? buyStock(interaction, stock, raw) : sellStock(interaction, stock, raw);
}
