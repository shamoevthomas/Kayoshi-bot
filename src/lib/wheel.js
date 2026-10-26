import { getWheelSpin, setWheelSpin, addMoney, getXpBoost, setXpBoost } from './store.js';
import { grantXp } from './levels.js';
import { formatMoney } from './shop.js';

// Roue de la fortune (/argent roue) : un tour toutes les 24 h. Lots tirés au hasard selon leur poids
// (sur 100) ; ce sont des lots fixes, sans boost de rôle. La roue « tourne » en deux étapes avant le résultat.
const DAY = 86_400_000;
const PRIZES = [
  { weight: 25, money: 50 },
  { weight: 20, money: 100 },
  { weight: 12, money: 250 },
  { weight: 6, money: 500 },
  { weight: 2, money: 1000 },
  { weight: 12, xp: 100 },
  { weight: 5, xp: 300 },
  { weight: 6, boost: { multiplier: 2, ms: 30 * 60_000 } },
  { weight: 12, nothing: true },
];
const FACES = ['💰', '📈', '🚀', '💨', '💎'];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function draw() {
  let roll = Math.random() * PRIZES.reduce((n, p) => n + p.weight, 0);
  for (const prize of PRIZES) {
    roll -= prize.weight;
    if (roll < 0) return prize;
  }
  return PRIZES.at(-1);
}

const spinning = (label) =>
  `🎡 **${label}** ${Array.from({ length: 5 }, () => FACES[Math.floor(Math.random() * FACES.length)]).join(' ')}`;

export async function spinWheel(interaction) {
  const { guild, user } = interaction;
  const now = Date.now();
  const last = getWheelSpin(guild.id, user.id);
  if (last && now - last < DAY) {
    return interaction.reply({ content: `⏳ Tu as déjà tourné la roue. Reviens <t:${Math.floor((last + DAY) / 1000)}:R>.`, ephemeral: true });
  }
  setWheelSpin(guild.id, user.id, now); // noté tout de suite : un seul tour même en cliquant vite
  const prize = draw();

  await interaction.reply({ content: spinning('La roue tourne…'), allowedMentions: { parse: [] } });
  await sleep(1200);
  await interaction.editReply(spinning('Elle ralentit…')).catch(() => {});
  await sleep(1200);

  let result;
  if (prize.money) {
    addMoney(guild.id, user.id, prize.money);
    result = `et gagne 💰 **${formatMoney(prize.money)}** !`;
  } else if (prize.xp) {
    result = `et gagne 📈 **${prize.xp} XP** !`;
  } else if (prize.boost) {
    // Comme un booster acheté : s'ajoute au temps restant, le plus fort multiplicateur est gardé.
    const current = getXpBoost(guild.id, user.id);
    const active = current?.endsAt > now ? current : null;
    setXpBoost(guild.id, user.id, {
      multiplier: Math.max(prize.boost.multiplier, active?.multiplier ?? 1),
      endsAt: (active?.endsAt ?? now) + prize.boost.ms,
    });
    result = `et gagne 🚀 un **booster XP ×${prize.boost.multiplier} pendant 30 min** !`;
  } else {
    result = '… et ne gagne rien du tout 💨 Retente ta chance demain !';
  }
  await interaction.editReply(`🎡 ${user} a fait tourner la roue ${result}\n-# Prochain tour <t:${Math.floor((now + DAY) / 1000)}:R>.`).catch(() => {});
  // XP donnée après l'annonce : un éventuel passage de niveau s'affiche juste en dessous.
  if (prize.xp) await grantXp({ guild, author: user, member: interaction.member, channel: interaction.channel }, prize.xp).catch(() => {});
}
