import { EmbedBuilder } from 'discord.js';
import { getQuests, getQuestWeek, setQuestWeek, getStatsData, addMoney } from './store.js';
import { currentMonday, weekDays } from './weeklytop.js';
import { grantLevels, boostedMoney } from './levels.js';
import { formatMoney } from './shop.js';

// Quêtes de la semaine (/quetes) : objectifs définis par le staff (messages, minutes de vocal,
// drops ramassés, dailies), récompensés en argent et/ou en niveaux. La progression repart à zéro
// chaque lundi (heure de Paris). Une quête terminée est payée une seule fois par semaine, dès
// l'action suivante du membre (message, drop, daily) ou quand il ouvre /quetes.
export const QUEST_TYPES = {
  messages: { name: 'Messages', label: (n) => `Écrire ${n} message${n > 1 ? 's' : ''}` },
  vocal: { name: 'Vocal (minutes)', label: (n) => `Passer ${n} min en vocal` },
  drops: { name: 'Drops ramassés', label: (n) => `Ramasser ${n} drop${n > 1 ? 's' : ''} d’argent` },
  daily: { name: 'Dailies', label: (n) => `Récupérer ${n} daily` },
};

export const questLabel = (q) => QUEST_TYPES[q.type]?.label(q.target) ?? q.type;

export function rewardText(q) {
  const parts = [];
  if (q.money) parts.push(`💰 ${formatMoney(q.money)}`);
  if (q.levels) parts.push(`📈 +${q.levels} niveau${q.levels > 1 ? 'x' : ''}`);
  return parts.join(' · ');
}

// Progression d'un membre cette semaine : messages et vocal d'après les stats (s?u),
// drops et dailies d'après les compteurs de la semaine.
export function questProgress(guildId, userId, week = currentMonday()) {
  const days = getStatsData(guildId).days ?? {};
  const keys = weekDays(week);
  const counts = getQuestWeek(guildId, week).counts[userId] ?? {};
  return {
    messages: keys.reduce((n, k) => n + (days[k]?.m?.[userId] ?? 0), 0),
    vocal: Math.floor(keys.reduce((n, k) => n + (days[k]?.v?.[userId] ?? 0), 0) / 60),
    drops: counts.drops ?? 0,
    daily: counts.daily ?? 0,
  };
}

export function doneQuests(guildId, userId, week = currentMonday()) {
  return getQuestWeek(guildId, week).done[userId] ?? [];
}

// Drop ramassé ou daily récupéré : compté pour les quêtes de la semaine.
export function countQuestAction(guildId, userId, kind) {
  const qw = getQuestWeek(guildId, currentMonday());
  qw.counts[userId] = { ...qw.counts[userId], [kind]: (qw.counts[userId]?.[kind] ?? 0) + 1 };
  setQuestWeek(guildId, qw);
}

// Paie les quêtes que le membre vient de terminer. ctx = { guild, author, member, channel }
// (un message convient ; channel peut être null : pas d'annonce). Renvoie les quêtes payées.
export async function checkQuests(ctx) {
  if (!ctx.guild || ctx.author.bot) return [];
  const quests = getQuests(ctx.guild.id);
  if (!quests.length) return [];
  const week = currentMonday();
  const qw = getQuestWeek(ctx.guild.id, week);
  const done = qw.done[ctx.author.id] ?? [];
  const progress = questProgress(ctx.guild.id, ctx.author.id, week);
  const finished = quests.filter((q) => !done.includes(q.id) && progress[q.type] >= q.target);
  if (!finished.length) return [];
  qw.done[ctx.author.id] = [...done, ...finished.map((q) => q.id)];
  setQuestWeek(ctx.guild.id, qw); // noté avant de payer : jamais deux fois la même quête

  for (const q of finished) {
    const money = boostedMoney(ctx.member, q.money ?? 0); // rôle boosté (/boostrole)
    if (ctx.channel) {
      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('📜 Quête terminée !')
        .setDescription(`${ctx.author} a terminé **${questLabel(q)}** et gagne ${rewardText({ ...q, money })} !`);
      await ctx.channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
    }
    if (money) addMoney(ctx.guild.id, ctx.author.id, money);
    // Niveaux : vrai passage de niveau (argent par niveau, annonce, rôles et salaires de palier).
    if (q.levels) await grantLevels(ctx, q.levels).catch((err) => console.error('[quetes]', err));
  }
  return finished;
}
