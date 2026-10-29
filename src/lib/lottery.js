import { EmbedBuilder } from 'discord.js';
import { getGuildConfig, setGuildConfig, getCoins, addCoins } from './store.js';
import { formatMoney } from './shop.js';
import { getWeekKey, getMonday } from './week.js';

// Loterie du casino (.loterie) : des tickets toute la semaine, tirage chaque dimanche à minuit (au passage
// à la nouvelle semaine) ; le gagnant, tiré au sort selon son nombre de tickets, remporte toute la cagnotte.
// Annonce dans le salon où le dernier ticket a été acheté. data[guildId].lottery = { week, tickets: { id: n },
// channelId, last: { userId, pot, tickets } }.
export const TICKET_PRICE = 100;
const MAX_TICKETS = 100; // par membre et par semaine

const getLottery = (guildId) => {
  const l = getGuildConfig(guildId).lottery ?? {};
  return { week: l.week ?? getWeekKey(), tickets: l.tickets ?? {}, channelId: l.channelId ?? null, last: l.last ?? null };
};
const setLottery = (guildId, lottery) => setGuildConfig(guildId, { lottery });
const pot = (tickets) => Object.values(tickets).reduce((n, t) => n + t, 0) * TICKET_PRICE;
// Prochain tirage : lundi suivant à minuit, heure de Paris (en secondes, pour <t:…>).
const nextDraw = () => {
  const monday = getMonday();
  monday.setUTCDate(monday.getUTCDate() + 7);
  const utcMidnight = monday.getTime() - 12 * 3_600_000;
  const parisHour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(utcMidnight)).find((p) => p.type === 'hour').value,
  );
  return Math.floor((utcMidnight - parisHour * 3_600_000) / 1000);
};

export async function lottery(interaction) {
  const { guild, user } = interaction;
  const l = getLottery(guild.id);
  const raw = interaction.options.getString('nombre');
  if (!raw) {
    const total = Object.values(l.tickets).reduce((n, t) => n + t, 0);
    const mine = l.tickets[user.id] ?? 0;
    const embed = new EmbedBuilder()
      .setColor(0xf1c40f)
      .setTitle('🎟️ Loterie de la semaine')
      .setDescription(
        [
          `💰 **Cagnotte :** 🪙 ${formatMoney(pot(l.tickets))}`,
          `🎟️ **Tickets vendus :** ${total} · **les tiens :** ${mine}${mine && total ? ` (${Math.round((mine / total) * 100)} % de chances)` : ''}`,
          `⏳ **Tirage :** <t:${nextDraw()}:R>`,
          l.last ? `\n🏆 Dernier gagnant : <@${l.last.userId}> (🪙 ${formatMoney(l.last.pot)})` : '',
        ].join('\n'),
      )
      .setFooter({ text: `.loterie <nombre> pour acheter des tickets · 🪙 ${TICKET_PRICE} le ticket, ${MAX_TICKETS} max par semaine` });
    return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  }
  const count = Number(raw);
  if (!Number.isInteger(count) || count < 1) return interaction.reply({ content: '❌ Indique un nombre de tickets : `.loterie 5`.', ephemeral: true });
  const mine = l.tickets[user.id] ?? 0;
  if (mine + count > MAX_TICKETS) return interaction.reply({ content: `❌ ${MAX_TICKETS} tickets maximum par semaine (tu en as déjà ${mine}).`, ephemeral: true });
  const cost = count * TICKET_PRICE;
  const pocket = getCoins(guild.id, user.id);
  if (pocket < cost) return interaction.reply({ content: `❌ ${count} ticket(s) coûtent 🪙 **${formatMoney(cost)}**, tu as 🪙 **${formatMoney(pocket)}** en poche.`, ephemeral: true });
  addCoins(guild.id, user.id, -cost);
  l.tickets[user.id] = mine + count;
  l.channelId = interaction.channelId;
  setLottery(guild.id, l);
  return interaction.reply({
    content: `🎟️ ${user} achète **${count}** ticket(s) (🪙 ${formatMoney(cost)}). Il en a ${mine + count}, la cagnotte monte à 🪙 **${formatMoney(pot(l.tickets))}** ! Tirage <t:${nextDraw()}:R>.`,
    allowedMentions: { parse: [] },
  });
}

// Chaque minute : à la nouvelle semaine, tire le gagnant de la semaine passée.
export async function lotteryTick(client) {
  const week = getWeekKey();
  for (const guild of client.guilds.cache.values()) {
    const l = getLottery(guild.id);
    if (l.week === week) continue;
    const entries = Object.entries(l.tickets).filter(([, n]) => n > 0);
    const next = { week, tickets: {}, channelId: l.channelId, last: l.last };
    if (entries.length) {
      const total = entries.reduce((n, [, t]) => n + t, 0);
      let roll = Math.random() * total;
      const [winner, tickets] = entries.find(([, t]) => (roll -= t) < 0) ?? entries[0];
      const amount = total * TICKET_PRICE;
      addCoins(guild.id, winner, amount);
      next.last = { userId: winner, pot: amount, tickets };
      const channel = l.channelId && guild.channels.cache.get(l.channelId);
      if (channel?.isTextBased()) {
        await channel
          .send({
            content: `<@${winner}>`,
            embeds: [
              new EmbedBuilder()
                .setColor(0xf1c40f)
                .setTitle('🎉 Tirage de la loterie !')
                .setDescription(`<@${winner}> remporte la cagnotte : 🪙 **${formatMoney(amount)}** avec ${tickets} ticket(s) sur ${total} !\n\nNouvelle semaine, nouvelle loterie : \`.loterie\``),
            ],
            allowedMentions: { users: [winner] },
          })
          .catch(() => {});
      }
    }
    setLottery(guild.id, next);
  }
}
