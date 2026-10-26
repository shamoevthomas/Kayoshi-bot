import { EmbedBuilder } from 'discord.js';
import { getWeeklyTop, setWeeklyTop, getStatsData, addMoney } from './store.js';
import { formatMoney } from './shop.js';
import { TIME_ZONE } from './stats.js';

// Membres de la semaine (/configeconomie semaine) : chaque lundi (heure de Paris), le top 3 des
// messages et le top 3 du vocal de la semaine écoulée (lundi → dimanche, stats de s?u) reçoivent
// l'argent choisi ; les deux premiers reçoivent le rôle facultatif, retiré aux gagnants précédents.
const DAY_MS = 86_400_000;
const MEDALS = ['🥇', '🥈', '🥉'];
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

const shiftDay = (key, days) => new Date(Date.parse(`${key}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

// Lundi (« 2026-10-26 ») de la semaine en cours, à Paris.
export function currentMonday(now = Date.now()) {
  const today = dayFormat.format(new Date(now));
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // 0 = lundi
  return shiftDay(today, -weekday);
}

// Les 7 jours (lundi → dimanche) de la semaine commençant à `monday`.
export const weekDays = (monday) => Array.from({ length: 7 }, (_, i) => shiftDay(monday, i));

// Lundi de la semaine qui vient de se terminer : c'est celle qu'on récompense ce lundi.
export const lastFinishedWeek = (now = Date.now()) => shiftDay(currentMonday(now), -7);

const voiceText = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
};
const dateText = (key) => key.split('-').reverse().slice(0, 2).join('/');

// Top 3 (messages ou vocal) de la semaine commençant à `monday`, membres encore sur le serveur.
async function weekTop(guild, monday, field) {
  const days = getStatsData(guild.id).days ?? {};
  const totals = {};
  for (let i = 0; i < 7; i++) {
    for (const [id, n] of Object.entries(days[shiftDay(monday, i)]?.[field] ?? {})) totals[id] = (totals[id] ?? 0) + n;
  }
  const ranked = Object.entries(totals).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  const top = [];
  for (const [id, value] of ranked) {
    if (top.length === 3) break;
    if (await guild.members.fetch(id).catch(() => null)) top.push({ id, value });
  }
  return top;
}

async function awardWeek(guild, cfg, monday) {
  const rewards = cfg.rewards ?? {};
  const topMessages = await weekTop(guild, monday, 'm');
  const topVoice = await weekTop(guild, monday, 'v');
  for (const [i, r] of topMessages.entries()) if (rewards[`m${i + 1}`]) addMoney(guild.id, r.id, rewards[`m${i + 1}`]);
  for (const [i, r] of topVoice.entries()) if (rewards[`v${i + 1}`]) addMoney(guild.id, r.id, rewards[`v${i + 1}`]);

  // Rôle : retiré aux gagnants précédents, donné aux premiers des messages et du vocal.
  const role = cfg.roleId ? guild.roles.cache.get(cfg.roleId) : null;
  const roleWinners = [...new Set([topMessages[0]?.id, topVoice[0]?.id].filter(Boolean))];
  if (role) {
    await guild.members.fetch().catch(() => null);
    for (const member of role.members.values()) {
      if (!roleWinners.includes(member.id)) await member.roles.remove(role, 'Membre de la semaine : semaine terminée').catch(() => {});
    }
    for (const id of roleWinners) await guild.members.cache.get(id)?.roles.add(role, 'Membre de la semaine').catch(() => {});
  }

  const channel = cfg.channelId && (guild.channels.cache.get(cfg.channelId) ?? (await guild.channels.fetch(cfg.channelId).catch(() => null)));
  if (!channel?.isTextBased?.()) return;
  const lines = (top, prefix, format) =>
    top.length
      ? top
          .map((r, i) => `${MEDALS[i]} <@${r.id}> — ${format(r.value)}${rewards[`${prefix}${i + 1}`] ? ` · 💰 **+${formatMoney(rewards[`${prefix}${i + 1}`])}**` : ''}`)
          .join('\n')
      : '_Personne cette semaine._';
  const embed = new EmbedBuilder()
    .setColor(0xf5c542)
    .setTitle('🏆 Membres de la semaine')
    .setDescription(`Semaine du ${dateText(monday)} au ${dateText(shiftDay(monday, 6))} : bravo aux plus actifs !`)
    .addFields(
      { name: '💬 Messages', value: lines(topMessages, 'm', (n) => `**${n}** message(s)`) },
      { name: '🔊 Vocal', value: lines(topVoice, 'v', (s) => `**${voiceText(s)}**`) },
    )
    .setTimestamp();
  if (role && roleWinners.length) embed.addFields({ name: 'Rôle', value: `${role} pour ${roleWinners.map((id) => `<@${id}>`).join(' et ')} cette semaine.` });
  const winners = [...new Set([...topMessages, ...topVoice].map((r) => r.id))];
  await channel.send({ content: winners.map((id) => `<@${id}>`).join(' ') || undefined, embeds: [embed], allowedMentions: { users: winners } });
}

// Appelée toutes les heures : récompense la semaine écoulée une seule fois, dès le lundi.
export async function processWeeklyTop(client) {
  const week = lastFinishedWeek();
  for (const guild of client.guilds.cache.values()) {
    const cfg = getWeeklyTop(guild.id);
    if (!cfg?.enabled || (cfg.lastWeek && cfg.lastWeek >= week)) continue;
    setWeeklyTop(guild.id, { ...cfg, lastWeek: week }); // noté d'abord : jamais deux fois la même semaine
    await awardWeek(guild, cfg, week).catch((err) => console.error('[semaine]', err));
  }
}
