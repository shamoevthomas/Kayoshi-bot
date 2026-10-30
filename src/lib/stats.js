import { PermissionFlagsBits } from 'discord.js';
import { getStatsData, markStatsDirty } from './store.js';

// Statistiques d'activité (s?u, s?t, s?m, s?v) : messages et temps vocal par jour,
// par membre et par salon, dans la ligne « stats:<guildId> » (voir store.js).
//   days[jour]   = { tm, tv, m:{membre:n}, v:{membre:s}, mc:{salon:n}, vc:{salon:s},
//                    um:{membre:{salon:n}}, uv:{membre:{salon:s}} }
//                  détail gardé PERIOD_DAYS jours, totaux (tm, tv) gardés KEEP_DAYS jours
//   hours[heure] = { tm, tv, m:{membre:n}, v:{membre:s} }   24 dernières heures, pour « 1j »
//   since        = début du suivi en direct ; backfilled = historique des messages récupéré
// Jours et heures en heure de Paris ; le temps vocal est en secondes.

export const PERIOD_DAYS = 14;
export const TIME_ZONE = 'Europe/Paris';
const KEEP_DAYS = 31;
const KEEP_HOURS = 25;
const BACKFILL_DAYS = 30;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

const partsFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

// Jour (« 2026-10-20 ») et heure (« 2026-10-20T14 ») d'un instant, à Paris.
function keysAt(ts) {
  const p = Object.fromEntries(partsFormat.formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  return { day, hour: `${day}T${p.hour}` };
}

// Les n derniers jours (aujourd'hui compris), du plus ancien au plus récent.
// Calcul sur le calendrier : pas de jour sauté aux changements d'heure.
export function lastDayKeys(n, now = Date.now()) {
  const [y, m, d] = keysAt(now).day.split('-').map(Number);
  const today = Date.UTC(y, m - 1, d);
  return Array.from({ length: n }, (_, i) => new Date(today - (n - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

function lastHourKeys(now = Date.now()) {
  return [...new Set(Array.from({ length: 24 }, (_, i) => keysAt(now - i * HOUR_MS).hour))];
}

const add = (obj, key, n) => (obj[key] = (obj[key] ?? 0) + n);
const addIn = (obj, field, key, n) => add((obj[field] ??= {}), key, n);
const addNested = (obj, field, key, sub, n) => add(((obj[field] ??= {})[key] ??= {}), sub, n);

// Ajoute un message ou du temps vocal à un objet de stats (celui du serveur, ou un
// objet temporaire pendant la récupération de l'historique).
function addMessage(data, userId, channelId, ts, now = Date.now()) {
  const { day, hour } = keysAt(ts);
  const d = ((data.days ??= {})[day] ??= {});
  add(d, 'tm', 1);
  addIn(d, 'm', userId, 1);
  addIn(d, 'mc', channelId, 1);
  addNested(d, 'um', userId, channelId, 1);
  if (now - ts < KEEP_HOURS * HOUR_MS) {
    const h = ((data.hours ??= {})[hour] ??= {});
    add(h, 'tm', 1);
    addIn(h, 'm', userId, 1);
  }
}

function addVoice(data, userId, channelId, seconds, ts) {
  const { day, hour } = keysAt(ts);
  const d = ((data.days ??= {})[day] ??= {});
  add(d, 'tv', seconds);
  addIn(d, 'v', userId, seconds);
  addIn(d, 'vc', channelId, seconds);
  addNested(d, 'uv', userId, channelId, seconds);
  const h = ((data.hours ??= {})[hour] ??= {});
  add(h, 'tv', seconds);
  addIn(h, 'v', userId, seconds);
}

// Retire les heures de plus de 25 h, le détail des jours hors période et les jours de plus d'un mois.
function prune(data, now = Date.now()) {
  const hourCutoff = keysAt(now - KEEP_HOURS * HOUR_MS).hour;
  for (const key of Object.keys(data.hours ?? {})) if (key < hourCutoff) delete data.hours[key];
  const detailKeys = new Set(lastDayKeys(PERIOD_DAYS + 1, now));
  const keepKeys = new Set(lastDayKeys(KEEP_DAYS, now));
  for (const [key, day] of Object.entries(data.days ?? {})) {
    if (!keepKeys.has(key)) delete data.days[key];
    else if (!detailKeys.has(key)) data.days[key] = { tm: day.tm ?? 0, tv: day.tv ?? 0 };
  }
}

const lastPrune = new Map();
function touch(guildId, data) {
  const now = Date.now();
  if (now - (lastPrune.get(guildId) ?? 0) > 10 * 60_000) {
    prune(data, now);
    lastPrune.set(guildId, now);
  }
  markStatsDirty(guildId);
}

// --- Enregistrement en direct ---

export function startStatsTracking(guildId) {
  const data = getStatsData(guildId);
  if (data.since) return;
  data.since = Date.now();
  markStatsDirty(guildId);
}

export function recordMessage(message) {
  if (!message.guild || message.author?.bot || message.webhookId) return;
  const data = getStatsData(message.guild.id);
  data.since ??= Date.now();
  // Un message dans un fil compte pour son salon.
  const channelId = message.channel.isThread?.() ? message.channel.parentId : message.channelId;
  addMessage(data, message.author.id, channelId, message.createdTimestamp || Date.now());
  touch(message.guild.id, data);
}

export function recordVoice(guildId, userId, channelId, seconds, ts = Date.now()) {
  const s = Math.round(seconds);
  if (!channelId || s <= 0) return;
  const data = getStatsData(guildId);
  data.since ??= Date.now();
  addVoice(data, userId, channelId, s, ts);
  touch(guildId, data);
}

// --- Historique des messages (une fois par serveur) ---

function addDeep(target, src) {
  for (const [key, value] of Object.entries(src)) {
    if (typeof value === 'number') target[key] = (target[key] ?? 0) + value;
    else addDeep((target[key] ??= {}), value);
  }
}

// Compte les messages des BACKFILL_DAYS derniers jours envoyés avant le début du suivi en
// direct. Tout est cumulé à part puis ajouté d'un coup : une récupération interrompue
// (redémarrage) ne compte rien en double et sera refaite.
export async function backfillMessages(guild) {
  const data = getStatsData(guild.id);
  if (data.backfilled) return;
  const until = (data.since ??= Date.now());
  const from = until - BACKFILL_DAYS * DAY_MS;
  const now = Date.now();
  const local = {};
  const started = Date.now();
  let count = 0;
  const me = guild.members.me;

  for (const channel of guild.channels.cache.values()) {
    if (!channel.isTextBased?.() || channel.isThread?.()) continue;
    if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) continue;
    let before;
    for (;;) {
      const batch = await channel.messages.fetch({ limit: 100, before, cache: false }).catch(() => null);
      if (!batch?.size) break;
      let reachedStart = false;
      for (const msg of batch.values()) {
        if (msg.createdTimestamp < from) {
          reachedStart = true;
          continue;
        }
        if (msg.createdTimestamp >= until || msg.author.bot || msg.webhookId) continue;
        addMessage(local, msg.author.id, channel.id, msg.createdTimestamp, now);
        count += 1;
      }
      before = batch.last().id;
      if (reachedStart || batch.size < 100) break;
    }
  }

  addDeep(data, local);
  data.backfilled = Date.now();
  prune(data);
  markStatsDirty(guild.id);
  console.log(`📊 Stats : historique de ${guild.name} récupéré (${count} messages, ${Math.round((Date.now() - started) / 1000)} s).`);
}

// --- Lecture ---

const sumOf = (buckets, field) => buckets.reduce((total, b) => total + (b?.[field] ?? 0), 0);
const sumFor = (buckets, field, id) => buckets.reduce((total, b) => total + (b?.[field]?.[id] ?? 0), 0);

function sumMaps(maps) {
  const out = {};
  for (const map of maps) for (const [id, n] of Object.entries(map ?? {})) out[id] = (out[id] ?? 0) + n;
  return out;
}

const ranking = (totals) =>
  Object.entries(totals)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([id, value]) => ({ id, value }));

function buckets(guildId, now = Date.now()) {
  const data = getStatsData(guildId);
  const days = data.days ?? {};
  const pick = (n) => lastDayKeys(n, now).map((k) => days[k]);
  return { data, hour: lastHourKeys(now).map((k) => data.hours?.[k]), d7: pick(7), d14: pick(PERIOD_DAYS), d30: pick(30) };
}

// Stats d'un membre sur la période (s?u).
export function userStats(guildId, userId) {
  const { data, hour, d7, d14 } = buckets(guildId);
  const msgRank = ranking(sumMaps(d14.map((d) => d?.m)));
  const voiceRank = ranking(sumMaps(d14.map((d) => d?.v)));
  const rankOf = (list) => {
    const i = list.findIndex((e) => e.id === userId);
    return i < 0 ? null : i + 1;
  };
  return {
    since: data.since,
    messages: { d1: sumFor(hour, 'm', userId), d7: sumFor(d7, 'm', userId), d14: sumFor(d14, 'm', userId) },
    voice: { d1: sumFor(hour, 'v', userId), d7: sumFor(d7, 'v', userId), d14: sumFor(d14, 'v', userId) },
    rank: { messages: rankOf(msgRank), voice: rankOf(voiceRank) },
    topMessageChannel: ranking(sumMaps(d14.map((d) => d?.um?.[userId])))[0] ?? null,
    topVoiceChannel: ranking(sumMaps(d14.map((d) => d?.uv?.[userId])))[0] ?? null,
    graph: d14.map((d) => ({ messages: d?.m?.[userId] ?? 0, voice: d?.v?.[userId] ?? 0 })),
  };
}

// Stats du serveur sur la période (s?t, s?m, s?v).
export function serverStats(guildId, limit = 3) {
  const { data, hour, d7, d14, d30 } = buckets(guildId);
  return {
    since: data.since,
    messages: { d1: sumOf(hour, 'tm'), d7: sumOf(d7, 'tm'), d14: sumOf(d14, 'tm'), d30: sumOf(d30, 'tm') },
    voice: { d1: sumOf(hour, 'tv'), d7: sumOf(d7, 'tv'), d14: sumOf(d14, 'tv'), d30: sumOf(d30, 'tv') },
    topMessageMembers: ranking(sumMaps(d14.map((d) => d?.m))).slice(0, limit),
    topMessageChannels: ranking(sumMaps(d14.map((d) => d?.mc))).slice(0, limit),
    topVoiceMembers: ranking(sumMaps(d14.map((d) => d?.v))).slice(0, limit),
    topVoiceChannels: ranking(sumMaps(d14.map((d) => d?.vc))).slice(0, limit),
  };
}

// Messages et secondes de vocal du serveur, jour par jour, sur les n derniers jours (+graph, 30 au plus).
export function serverDays(guildId, n = 30) {
  const days = getStatsData(guildId).days ?? {};
  return lastDayKeys(Math.min(n, KEEP_DAYS - 1)).map((key) => ({ key, messages: days[key]?.tm ?? 0, voice: days[key]?.tv ?? 0 }));
}
