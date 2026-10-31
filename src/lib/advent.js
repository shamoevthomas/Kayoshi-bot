import { EmbedBuilder } from 'discord.js';
import { getAdvent, setAdvent, addCoins, addMoney, getXpBoost, setXpBoost } from './store.js';
import { formatMoney } from './shop.js';

// Calendrier de l'Avent (« +avent ») : du 1er au 24 décembre (heure de Paris), chaque membre ouvre la case du
// jour une fois. Les cadeaux montent au fil des jours (coins, argent, boosters d'XP) ; le 24, ceux qui ont ouvert
// les 24 cases gagnent un gros bonus. data[guildId].advent = { userId: { year, days } }.
const DAYS = 24;
const HOUR = 3_600_000;
const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

export function parisDate(now = Date.now()) {
  const p = Object.fromEntries(parts.formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day) };
}

// Minuit (heure de Paris) au début du jour donné, en ms.
function parisMidnight(year, month, day) {
  const utc = Date.UTC(year, month - 1, day);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(new Date(utc)));
  return utc - hour * HOUR;
}

// Cadeau de chaque case (le même pour tout le monde, mais on ne le découvre qu'en l'ouvrant).
const BOOST_DAYS = { 6: { multiplier: 2, hours: 1 }, 13: { multiplier: 2, hours: 2 }, 20: { multiplier: 2, hours: 3 } };
const MONEY_DAYS = { 3: 500, 9: 800, 15: 1000, 21: 1500 };
export function adventGift(day) {
  if (day === DAYS) return { coins: 2000, money: 1000, text: 'la grande case du réveillon' };
  if (BOOST_DAYS[day]) return { coins: 200, boost: BOOST_DAYS[day] };
  if (MONEY_DAYS[day]) return { coins: 200, money: MONEY_DAYS[day] };
  return { coins: 250 + day * 25 };
}
export const FULL_BONUS = { coins: 5000, money: 3000, boost: { multiplier: 3, hours: 3 } };

function giveBoost(guildId, userId, boost, now) {
  // Comme un booster acheté : s'ajoute au temps restant, le plus fort multiplicateur est gardé.
  const current = getXpBoost(guildId, userId);
  const active = current?.endsAt > now ? current : null;
  setXpBoost(guildId, userId, { multiplier: Math.max(boost.multiplier, active?.multiplier ?? 1), endsAt: (active?.endsAt ?? now) + boost.hours * HOUR });
}

function giveGift(guildId, userId, gift, now) {
  const lines = [];
  if (gift.coins) {
    addCoins(guildId, userId, gift.coins);
    lines.push(`🪙 **+${formatMoney(gift.coins)}** coins`);
  }
  if (gift.money) {
    addMoney(guildId, userId, gift.money);
    lines.push(`💰 **+${formatMoney(gift.money)}** d’argent`);
  }
  if (gift.boost) {
    giveBoost(guildId, userId, gift.boost, now);
    lines.push(`🚀 un **booster XP ×${gift.boost.multiplier}** pendant **${gift.boost.hours} h**`);
  }
  return lines;
}

// Les 24 cases : ✅ ouverte, ❌ ratée, 🎁 à ouvrir aujourd'hui, 🔒 pas encore.
function grid(days, today) {
  const rows = [];
  for (let r = 0; r < 4; r++) {
    const cells = [];
    for (let c = 1; c <= 6; c++) {
      const d = r * 6 + c;
      const mark = days.includes(d) ? '✅' : d < today ? '❌' : d === today ? '🎁' : '🔒';
      cells.push(`\`${String(d).padStart(2, '0')}\`${mark}`);
    }
    rows.push(cells.join(' '));
  }
  return rows.join('\n');
}

export async function handleAdventCommand(message, now = Date.now()) {
  if (!message.guild || message.author.bot || !/^\+avent$/i.test(message.content.trim())) return false;
  const { guild, author } = message;
  const { year, month, day } = parisDate(now);
  const saved = getAdvent(guild.id, author.id);
  const days = saved?.year === year ? [...saved.days] : [];
  const reply = (payload) => message.reply({ allowedMentions: { parse: [], repliedUser: false }, ...payload }).catch(() => {});
  const embed = new EmbedBuilder().setColor(0xc0392b).setTitle('🎄 Calendrier de l’Avent');

  // En dehors du 1er au 24 décembre.
  if (month !== 12 || day > DAYS) {
    if (month === 12) {
      embed.setDescription(`Le calendrier est terminé pour cette année : tu as ouvert **${days.length}/${DAYS}** cases.\n\n${grid(days, DAYS + 1)}\n\nJoyeuses fêtes ! 🎅`);
    } else {
      const opening = parisMidnight(month === 12 ? year + 1 : year, 12, 1);
      embed.setDescription(
        `Le calendrier ouvre le **1er décembre** (<t:${Math.floor(opening / 1000)}:R>) : une case à ouvrir chaque jour jusqu’au 24 avec \`+avent\`.\n` +
          `🎁 Coins, argent, boosters d’XP… et un **gros bonus le 24** pour ceux qui n’ont raté aucune case !`,
      );
    }
    await reply({ embeds: [embed] });
    return true;
  }

  const next = Math.floor(parisMidnight(year, 12, day + 1) / 1000);
  if (days.includes(day)) {
    embed
      .setDescription(`Tu as déjà ouvert la case du **${day} décembre** ! Prochaine case <t:${next}:R>.\n\n${grid(days, day)}`)
      .setFooter({ text: `${days.length}/${DAYS} cases ouvertes` });
    await reply({ embeds: [embed] });
    return true;
  }

  // Ouverture de la case du jour (notée d'abord : jamais deux fois).
  days.push(day);
  setAdvent(guild.id, author.id, { year, days });
  const gift = adventGift(day);
  const lines = giveGift(guild.id, author.id, gift, now);
  let bonus = '';
  if (day === DAYS) {
    bonus =
      days.length === DAYS
        ? `\n\n🌟 **Tu as ouvert les 24 cases !** Bonus du calendrier complet :\n${giveGift(guild.id, author.id, FULL_BONUS, now).join('\n')}`
        : `\n\n-# Tu as ouvert ${days.length}/24 cases : le bonus du calendrier complet était pour ceux qui n’en ont raté aucune.`;
  }
  embed
    .setTitle(`🎄 Calendrier de l’Avent — case du ${day} décembre`)
    .setDescription(
      `${author} ouvre ${gift.text ?? 'sa case'} et trouve :\n${lines.join('\n')}${bonus}\n\n${grid(days, day)}` +
        (day < DAYS ? `\n\n-# Prochaine case <t:${next}:R>.` : '\n\nJoyeux Noël ! 🎅'),
    )
    .setFooter({ text: `${days.length}/${DAYS} cases ouvertes` });
  await reply({ embeds: [embed] });
  return true;
}
