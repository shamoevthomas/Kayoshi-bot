import { EmbedBuilder } from 'discord.js';
import { getMoney, addMoney, getBank, addBank, getHeist, patchHeist } from './store.js';
import { formatMoney } from './shop.js';

// Poche et banque (/argent solde, deposer, retirer), vols et anti-vol (/argent voler, antivol).
// L'argent gagné arrive en poche : c'est lui qu'on dépense, qu'on mise au casino… et qu'on peut se faire voler.
// La banque est à l'abri des vols.
const HOUR = 3_600_000;
const ROB_COOLDOWN = HOUR;
const ROB_SAFE_AFTER = 30 * 60_000; // un membre volé ne peut pas l'être à nouveau pendant 30 min
const ROB_CHANCE = 0.45;
const ROB_MIN = 100; // en poche, pour le voleur (de quoi payer l'amende) comme pour sa cible
export const SHIELD_PRICE = 250;
export const KEEP_IN_POCKET = 200; // minimum gardé en poche quand on dépose à la banque
const SHIELD_MS = 12 * HOUR;
const SHIELD_MAX = 48 * HOUR;

const rand = (min, max) => min + Math.random() * (max - min);
const ts = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;

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

export const shieldEnd = (guildId, userId) => {
  const end = getHeist(guildId, userId).shield ?? 0;
  return end > Date.now() ? end : 0;
};

export async function showBalance(interaction) {
  const { guild } = interaction;
  const user = interaction.options.getUser('membre') ?? interaction.user;
  if (user.bot) return interaction.reply({ content: '❌ Un bot n’a pas de porte-monnaie.', ephemeral: true });
  const pocket = getMoney(guild.id, user.id);
  const bank = getBank(guild.id, user.id);
  const shield = shieldEnd(guild.id, user.id);
  const lines = [
    `👛 **Poche :** 💰 ${formatMoney(pocket)}  _(peut être volée)_`,
    `🏦 **Banque :** 💰 ${formatMoney(bank)}  _(à l’abri)_`,
    `💎 **Total :** 💰 ${formatMoney(pocket + bank)}`,
    '',
    `🛡️ **Anti-vol :** ${shield ? `actif, fin ${ts(shield)}` : 'aucun'}`,
  ];
  if (user.id === interaction.user.id) {
    const h = getHeist(guild.id, user.id);
    const ready = (at, cd) => (at && Date.now() - at < cd ? ts(at + cd) : 'disponible ✅');
    lines.push(`⏳ **Prochain vol :** ${ready(h.rob, ROB_COOLDOWN)}`);
  }
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setAuthor({ name: `Argent de ${user.displayName ?? user.username}`, iconURL: user.displayAvatarURL() })
    .setDescription(lines.join('\n'))
    .setFooter({ text: 'Mets ton argent à l’abri : /argent deposer · classement des poches : /top poche' });
  return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

// Poche → banque (deposer) ou banque → poche (retirer). Sans montant : tout.
// Pour déposer, il faut garder au moins KEEP_IN_POCKET en poche (« tout » = tout sauf ça).
export async function moveMoney(interaction, toBank) {
  const { guild, user } = interaction;
  const from = toBank ? getMoney(guild.id, user.id) : getBank(guild.id, user.id);
  const max = toBank ? Math.max(0, from - KEEP_IN_POCKET) : from;
  if (toBank && !max) {
    return interaction.reply({
      content: `❌ Tu dois garder au moins 💰 **${KEEP_IN_POCKET}** en poche : tu as 💰 **${formatMoney(from)}**, tu ne peux rien déposer pour l’instant.`,
      ephemeral: true,
    });
  }
  const amount = parseAmount(interaction.options.getString('montant') ?? 'tout', max);
  if (amount === null || amount <= 0) {
    if (!from) return interaction.reply({ content: '❌ Tu n’as rien à la banque.', ephemeral: true });
    return interaction.reply({ content: '❌ Montant invalide (ex : `500`, `2k`, `moitié` ou `tout`).', ephemeral: true });
  }
  if (amount > max) {
    return interaction.reply({
      content: toBank
        ? `❌ Tu dois garder au moins 💰 **${KEEP_IN_POCKET}** en poche : tu peux déposer au maximum 💰 **${formatMoney(max)}**.`
        : `❌ Tu n’as que 💰 **${formatMoney(from)}** à la banque.`,
      ephemeral: true,
    });
  }
  addMoney(guild.id, user.id, toBank ? -amount : amount);
  addBank(guild.id, user.id, toBank ? amount : -amount);
  const verb = toBank ? `🏦 ${user} dépose 💰 **${formatMoney(amount)}** à la banque.` : `👛 ${user} retire 💰 **${formatMoney(amount)}** de la banque.`;
  return interaction.reply({
    content: `${verb}\n-# Poche : 💰 ${formatMoney(getMoney(guild.id, user.id))} · Banque : 💰 ${formatMoney(getBank(guild.id, user.id))}`,
    allowedMentions: { parse: [] },
  });
}

export async function rob(interaction) {
  const { guild, user } = interaction;
  const target = interaction.options.getMember('membre');
  const reply = (content) => interaction.reply({ content, ephemeral: true });
  if (!target) return reply('❌ Ce membre n’est pas sur le serveur.');
  if (target.user.bot) return reply('❌ On ne peut pas voler un bot.');
  if (target.id === user.id) return reply('❌ Tu ne peux pas te voler toi-même.');

  const now = Date.now();
  const me = getHeist(guild.id, user.id);
  if (me.rob && now - me.rob < ROB_COOLDOWN) return reply(`⏳ Tu as déjà tenté un vol. Réessaie ${ts(me.rob + ROB_COOLDOWN)}.`);
  const myPocket = getMoney(guild.id, user.id);
  if (myPocket < ROB_MIN) return reply(`❌ Il te faut au moins 💰 **${ROB_MIN}** en poche pour tenter un vol (si tu te fais attraper, tu paies une amende).`);
  const shield = shieldEnd(guild.id, target.id);
  if (shield) return reply(`🛡️ ${target} est protégé par un anti-vol (fin ${ts(shield)}).`);
  const victim = getHeist(guild.id, target.id);
  if (victim.robbed && now - victim.robbed < ROB_SAFE_AFTER) return reply(`😮‍💨 ${target} vient de se faire voler, laisse-le souffler (${ts(victim.robbed + ROB_SAFE_AFTER)}).`);
  const theirPocket = getMoney(guild.id, target.id);
  if (theirPocket < ROB_MIN) return reply(`❌ ${target} n’a presque rien en poche (💰 ${formatMoney(theirPocket)}).`);

  patchHeist(guild.id, user.id, { rob: now });
  if (Math.random() < ROB_CHANCE) {
    const stolen = Math.max(1, Math.round(theirPocket * rand(0.1, 0.3)));
    addMoney(guild.id, target.id, -stolen);
    addMoney(guild.id, user.id, stolen);
    patchHeist(guild.id, target.id, { robbed: now });
    return interaction.reply({
      content: `🦹 ${user} a volé 💰 **${formatMoney(stolen)}** à ${target} !\n-# Protège ta poche : \`/argent deposer\` ou \`/argent antivol\`.`,
      allowedMentions: { users: [target.id] },
    });
  }
  const fine = Math.min(myPocket, Math.max(50, Math.round(myPocket * rand(0.1, 0.2))));
  addMoney(guild.id, user.id, -fine);
  addMoney(guild.id, target.id, fine);
  return interaction.reply({
    content: `🚨 ${user} s’est fait attraper en essayant de voler ${target} et lui paie une amende de 💰 **${formatMoney(fine)}** !`,
    allowedMentions: { users: [target.id] },
  });
}

// Anti-vol : 12 h de protection de la poche, cumulables jusqu'à 48 h.
export async function buyShield(interaction) {
  const { guild, user } = interaction;
  const now = Date.now();
  const end = shieldEnd(guild.id, user.id) || now;
  if (end - now + SHIELD_MS > SHIELD_MAX) {
    return interaction.reply({ content: `🛡️ Ton anti-vol est déjà au maximum (48 h). Il finit ${ts(end)}.`, ephemeral: true });
  }
  const pocket = getMoney(guild.id, user.id);
  if (pocket < SHIELD_PRICE) {
    return interaction.reply({ content: `❌ L’anti-vol coûte 💰 **${SHIELD_PRICE}** (en poche), tu as **${formatMoney(pocket)}**.`, ephemeral: true });
  }
  addMoney(guild.id, user.id, -SHIELD_PRICE);
  patchHeist(guild.id, user.id, { shield: end + SHIELD_MS });
  return interaction.reply({
    content: `🛡️ ${user} achète un anti-vol pour 💰 **${SHIELD_PRICE}** : personne ne peut lui voler sa poche jusqu’à ${ts(end + SHIELD_MS)}.`,
    allowedMentions: { parse: [] },
  });
}
