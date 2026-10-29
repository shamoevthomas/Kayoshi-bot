import { EmbedBuilder } from 'discord.js';
import { getCoins, addCoins, getMoney, getBank, addBank, getHeist, patchHeist, getDaily, setDaily, getLivret, getRep, getCasinoInv } from './store.js';
import { BUILDINGS, PAYOUT_MS, buildingIncome } from './casinoshop.js';
import { teamOf } from './teams.js';
import { formatMoney } from './shop.js';
import { boostedMoney, roleBoost } from './levels.js';
import { countQuestAction, checkQuests } from './quests.js';

// Coins du casino (🪙), commandes « . » (lib/prefix.js) : .balance, .dep, .with, .rob, .daily, .pay.
// Séparés de l'argent des niveaux (💰, /shop). Les coins gagnés arrivent en poche : on les mise, on les dépense
// dans .shop… et on peut se les faire voler. La banque et le livret (.livret) sont à l'abri des vols.
// Les fonctions reçoivent une « interaction » : celle que lib/prefix.js fabrique à partir du message.
const HOUR = 3_600_000;
// Délai entre deux utilisations (affichés dans .balance). L'anti-rob s'achète dans .shop (lib/casinoshop.js).
export const COOLDOWNS = { work: HOUR, slut: HOUR, mine: HOUR, fish: HOUR, gift: 2 * HOUR, rob: HOUR, rep: 24 * HOUR };
const ROB_SAFE_AFTER = 30 * 60_000; // un membre volé ne peut pas l'être à nouveau pendant 30 min
const ROB_CHANCE = 0.45;
const ROB_MIN = 100; // en poche, pour le voleur (de quoi payer l'amende) comme pour sa cible
export const KEEP_IN_POCKET = 200; // minimum gardé en poche quand on dépose (banque, livret)
const DAILY_BASE = 100;
const DAILY_STREAK_BONUS = 10; // en plus par jour de série
const DAILY_MAX = 200;
const DAY = 86_400_000;

export const rand = (min, max) => min + Math.random() * (max - min);
export const ts = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

// Montant écrit par le membre : « 500 », « 2k », « 1,5m », « 3md », « 25% », « moitié » ou « tout ».
// all = le maximum possible (« tout »). Renvoie un entier, ou null si illisible.
export function parseAmount(input, all) {
  let s = String(input ?? '').trim().toLowerCase().replace(/[\s_  ]/g, '');
  if (['tout', 'all', 'max', 'tt'].includes(s)) return all;
  if (['moitie', 'moitié', 'half'].includes(s)) return Math.floor(all / 2);
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // 1.000.000
  s = s.replace(',', '.');
  const pct = s.match(/^(\d+(?:\.\d+)?)%$/);
  if (pct) return Math.floor((all * Math.min(100, Number(pct[1]))) / 100);
  const m = s.match(/^(\d+(?:\.\d+)?)(k|m|md|b)?$/);
  if (!m) return null;
  return Math.floor(Number(m[1]) * ({ k: 1e3, m: 1e6, md: 1e9, b: 1e9 }[m[2]] ?? 1));
}

// Délai restant avant de pouvoir refaire `key` (0 si c'est bon).
export function cooldownLeft(guildId, userId, key) {
  const at = getHeist(guildId, userId)[key];
  return at && Date.now() - at < COOLDOWNS[key] ? at + COOLDOWNS[key] : 0;
}

export const shieldEnd = (guildId, userId) => {
  const end = getHeist(guildId, userId).shield ?? 0;
  return end > Date.now() ? end : 0;
};

export async function showBalance(interaction) {
  const { guild } = interaction;
  const user = interaction.options.getUser('membre') ?? interaction.user;
  if (user.bot) return interaction.reply({ content: '❌ Un bot n’a pas de porte-monnaie.', ephemeral: true });
  const pocket = getCoins(guild.id, user.id);
  const bank = getBank(guild.id, user.id);
  const livret = getLivret(guild.id, user.id).amount;
  const shield = shieldEnd(guild.id, user.id);
  const lines = [
    `👛 **Poche :** 🪙 ${formatMoney(pocket)}  _(peut être volée)_`,
    `🏦 **Banque :** 🪙 ${formatMoney(bank)}  _(à l’abri)_`,
    `📘 **Livret A :** 🪙 ${formatMoney(livret)}  _(à l’abri, rapporte des intérêts)_`,
    `💎 **Total :** 🪙 ${formatMoney(pocket + bank + livret)} coins`,
    '',
    `💰 **Argent des niveaux :** ${formatMoney(getMoney(guild.id, user.id))}  _(séparé des coins, pour \`/shop\`)_`,
    `⭐ **Réputation :** ${getRep(guild.id, user.id)} · 👥 **Team :** ${teamOf(guild.id, user.id)?.name ?? 'aucune'}`,
    `🛡️ **Anti-rob :** ${shield ? `actif, fin ${ts(shield)}` : 'aucun'}`,
  ];
  // Boutique du casino (.shop) : bâtiments et wagon.
  const inv = getCasinoInv(guild.id, user.id);
  const owned = BUILDINGS.filter((b) => inv.buildings.includes(b.id));
  if (owned.length) {
    const next = inv.lastPayout ? ` · prochain revenu ${ts(inv.lastPayout + PAYOUT_MS)}` : '';
    lines.push(`🏢 **Bâtiments :** ${owned.map((b) => `${b.emoji} ${b.name}`).join(', ')} — 🪙 ${formatMoney(buildingIncome(inv))} toutes les 2 h${next}`);
  }
  if (inv.wagon) {
    const ores = Object.values(inv.ores).reduce((n, q) => n + q, 0);
    lines.push(`🛒 **Wagon :** ${ores ? `${ores} minerai(s) à vendre (\`.wagon\`)` : 'vide'}`);
  }
  if (user.id === interaction.user.id) {
    const ready = (key) => {
      const left = cooldownLeft(guild.id, user.id, key);
      return left ? ts(left) : '✅';
    };
    lines.push(`⏳ \`.work\` ${ready('work')} · \`.slut\` ${ready('slut')} · \`.mine\` ${ready('mine')} · \`.fish\` ${ready('fish')} · \`.gift\` ${ready('gift')} · \`.rob\` ${ready('rob')}`);
  }
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setAuthor({ name: `Coins de ${user.displayName ?? user.username}`, iconURL: user.displayAvatarURL() })
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Mets tes coins à l’abri : .dep ou .livret · classements : /top coins, /top poche' });
  return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

// Poche → banque (.dep) ou banque → poche (.with). Sans montant : tout.
// Pour déposer, il faut garder au moins KEEP_IN_POCKET en poche (« tout » = tout sauf ça).
export async function moveMoney(interaction, toBank) {
  const { guild, user } = interaction;
  const from = toBank ? getCoins(guild.id, user.id) : getBank(guild.id, user.id);
  const max = toBank ? Math.max(0, from - KEEP_IN_POCKET) : from;
  if (toBank && !max) {
    return interaction.reply({
      content: `❌ Tu dois garder au moins 🪙 **${KEEP_IN_POCKET}** en poche : tu as 🪙 **${formatMoney(from)}**, tu ne peux rien déposer pour l’instant.`,
      ephemeral: true,
    });
  }
  const amount = parseAmount(interaction.options.getString('montant') ?? 'tout', max);
  if (amount === null || amount <= 0) {
    if (!from) return interaction.reply({ content: '❌ Tu n’as rien à la banque.', ephemeral: true });
    return interaction.reply({ content: '❌ Montant invalide (ex : `500`, `2k`, `moitié` ou `all`).', ephemeral: true });
  }
  if (amount > max) {
    return interaction.reply({
      content: toBank
        ? `❌ Tu dois garder au moins 🪙 **${KEEP_IN_POCKET}** en poche : tu peux déposer au maximum 🪙 **${formatMoney(max)}**.`
        : `❌ Tu n’as que 🪙 **${formatMoney(from)}** à la banque.`,
      ephemeral: true,
    });
  }
  addCoins(guild.id, user.id, toBank ? -amount : amount);
  addBank(guild.id, user.id, toBank ? amount : -amount);
  const verb = toBank ? `🏦 ${user} dépose 🪙 **${formatMoney(amount)}** à la banque.` : `👛 ${user} retire 🪙 **${formatMoney(amount)}** de la banque.`;
  return interaction.reply({
    content: `${verb}\n-# Poche : 🪙 ${formatMoney(getCoins(guild.id, user.id))} · Banque : 🪙 ${formatMoney(getBank(guild.id, user.id))}`,
    allowedMentions: { parse: [] },
  });
}

export async function rob(interaction) {
  const { guild, user } = interaction;
  const target = interaction.options.getMember('membre');
  const reply = (content) => interaction.reply({ content, ephemeral: true });
  if (!target) return reply('❌ Mentionne le membre à voler : `.rob @membre`.');
  if (target.user.bot) return reply('❌ On ne peut pas voler un bot.');
  if (target.id === user.id) return reply('❌ Tu ne peux pas te voler toi-même.');
  const myTeam = teamOf(guild.id, user.id);
  if (myTeam?.members.includes(target.id)) return reply(`❌ ${target} est dans ta team (**${myTeam.name}**).`);

  const now = Date.now();
  const left = cooldownLeft(guild.id, user.id, 'rob');
  if (left) return reply(`⏳ Tu as déjà tenté un vol. Réessaie ${ts(left)}.`);
  const myPocket = getCoins(guild.id, user.id);
  if (myPocket < ROB_MIN) return reply(`❌ Il te faut au moins 🪙 **${ROB_MIN}** en poche pour tenter un vol (si tu te fais attraper, tu paies une amende).`);
  const shield = shieldEnd(guild.id, target.id);
  if (shield) return reply(`🛡️ ${target} est protégé par un anti-vol (fin ${ts(shield)}).`);
  const victim = getHeist(guild.id, target.id);
  if (victim.robbed && now - victim.robbed < ROB_SAFE_AFTER) return reply(`😮‍💨 ${target} vient de se faire voler, laisse-le souffler (${ts(victim.robbed + ROB_SAFE_AFTER)}).`);
  const theirPocket = getCoins(guild.id, target.id);
  if (theirPocket < ROB_MIN) return reply(`❌ ${target} n’a presque rien en poche (🪙 ${formatMoney(theirPocket)}).`);

  patchHeist(guild.id, user.id, { rob: now });
  if (Math.random() < ROB_CHANCE) {
    const stolen = Math.max(1, Math.round(theirPocket * rand(0.1, 0.3)));
    addCoins(guild.id, target.id, -stolen);
    addCoins(guild.id, user.id, stolen);
    patchHeist(guild.id, target.id, { robbed: now });
    return interaction.reply({
      content: `🦹 ${user} a volé 🪙 **${formatMoney(stolen)}** à ${target} !\n-# Protège ta poche : \`.dep\`, \`.livret\` ou l’anti-rob de \`.shop\`.`,
      allowedMentions: { users: [target.id] },
    });
  }
  const fine = Math.min(myPocket, Math.max(50, Math.round(myPocket * rand(0.1, 0.2))));
  addCoins(guild.id, user.id, -fine);
  addCoins(guild.id, target.id, fine);
  return interaction.reply({
    content: `🚨 ${user} s’est fait attraper en essayant de voler ${target} et lui paie une amende de 🪙 **${formatMoney(fine)}** !`,
    allowedMentions: { users: [target.id] },
  });
}

// Daily : une fois toutes les 24 h. Série : daily récupéré moins de 48 h après le précédent
// (+10 par jour de série, jusqu'à 200).
export async function daily(interaction) {
  const { guild, user } = interaction;
  const now = Date.now();
  const record = getDaily(guild.id, user.id);
  if (record && now - record.last < DAY) {
    return interaction.reply({ content: `⏳ Tu as déjà récupéré ton daily. Reviens ${ts(record.last + DAY)}.`, ephemeral: true });
  }
  const streak = record && now - record.last < 2 * DAY ? record.streak + 1 : 1;
  const base = Math.min(DAILY_BASE + DAILY_STREAK_BONUS * (streak - 1), DAILY_MAX);
  const gain = boostedMoney(interaction.member, base); // rôle boosté (/boostrole)
  const boost = roleBoost(interaction.member, 'money');
  setDaily(guild.id, user.id, { last: now, streak });
  const balance = addCoins(guild.id, user.id, gain);
  const series = streak > 1 ? ` (série de **${streak}** jours 🔥)` : '';
  const boostNote = boost > 1 ? ` (bonus de rôle ×${boost.toLocaleString('fr-FR')})` : '';
  const hint = base < DAILY_MAX ? 'Reviens demain : +10 par jour de série, jusqu’à 200.' : 'Bonus de série au maximum, garde le rythme !';
  await interaction.reply({
    content: `🎁 ${user} récupère son daily : 🪙 **+${formatMoney(gain)}**${boostNote}${series}. Poche : 🪙 **${formatMoney(balance)}**.\n-# ${hint}`,
    allowedMentions: { parse: [] },
  });
  countQuestAction(guild.id, user.id, 'daily');
  await checkQuests({ guild, author: user, member: interaction.member, channel: interaction.channel });
}

// .pay @membre <montant|all> : donner de l'argent de sa poche.
export async function pay(interaction) {
  const { guild, user } = interaction;
  const target = interaction.options.getMember('membre');
  if (!target) return interaction.reply({ content: '❌ Mentionne le membre à payer : `.pay @membre 500`.', ephemeral: true });
  if (target.user.bot) return interaction.reply({ content: '❌ On ne peut pas donner de coins à un bot.', ephemeral: true });
  if (target.id === user.id) return interaction.reply({ content: '❌ Tu ne peux pas te donner des coins à toi-même.', ephemeral: true });
  const pocket = getCoins(guild.id, user.id);
  const amount = parseAmount(interaction.options.getString('montant'), pocket);
  if (!amount || amount <= 0) return interaction.reply({ content: '❌ Indique un montant : `.pay @membre 500` (ou `all`).', ephemeral: true });
  if (amount > pocket) return interaction.reply({ content: `❌ Tu n’as que 🪙 **${formatMoney(pocket)}** en poche.`, ephemeral: true });
  addCoins(guild.id, user.id, -amount);
  addCoins(guild.id, target.id, amount);
  return interaction.reply({ content: `💸 ${user} a donné 🪙 **${formatMoney(amount)}** à ${target} !`, allowedMentions: { users: [target.id] } });
}
