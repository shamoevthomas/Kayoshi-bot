import { EmbedBuilder } from 'discord.js';
import { getGuildConfig, setGuildConfig } from './store.js';

// Happy hour du casino : chaque jour, pendant 1 h à un moment au hasard entre 15 h et 22 h (heure de Paris),
// les gains de .work, .slut, .gift, .fish et de la revente du wagon sont doublés. Annoncée dans le dernier
// salon où une commande « . » a servi. Réglages : data[guildId].happyHour = { day, startMin, announced } ;
// data[guildId].casinoChannelId = dernier salon du casino.
const DURATION_MIN = 60;
const parts = () =>
  Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
const today = () => {
  const p = parts();
  return { day: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
};

// Le créneau du jour (tiré au hasard la première fois qu'on le demande).
function slot(guildId) {
  const { day } = today();
  const hh = getGuildConfig(guildId).happyHour;
  if (hh?.day === day) return hh;
  const next = { day, startMin: 15 * 60 + Math.floor(Math.random() * (7 * 60)), announced: false };
  setGuildConfig(guildId, { happyHour: next });
  return next;
}

export function isHappyHour(guildId) {
  const { minute } = today();
  const { startMin } = slot(guildId);
  return minute >= startMin && minute < startMin + DURATION_MIN;
}

// Gain avec la happy hour : { amount, note }.
export function happyBoost(guildId, amount) {
  return isHappyHour(guildId) ? { amount: amount * 2, note: ' _(happy hour ×2 🎉)_' } : { amount, note: '' };
}

export function noteCasinoChannel(guildId, channelId) {
  if (getGuildConfig(guildId).casinoChannelId !== channelId) setGuildConfig(guildId, { casinoChannelId: channelId });
}

// Chaque minute : annonce le début de la happy hour.
export async function happyHourTick(client) {
  for (const guild of client.guilds.cache.values()) {
    const channelId = getGuildConfig(guild.id).casinoChannelId;
    if (!channelId || !isHappyHour(guild.id)) continue;
    const hh = slot(guild.id);
    if (hh.announced) continue;
    setGuildConfig(guild.id, { happyHour: { ...hh, announced: true } });
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.isTextBased()) continue;
    const end = Math.floor((Date.now() + DURATION_MIN * 60_000) / 1000);
    await channel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xf1c40f)
            .setTitle('🎉 HAPPY HOUR !')
            .setDescription(`Pendant 1 h, les gains de \`.work\`, \`.slut\`, \`.gift\`, \`.fish\` et la revente du \`.wagon\` sont **doublés** !\nFin <t:${end}:R>.`),
        ],
      })
      .catch(() => {});
  }
}
