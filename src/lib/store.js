import { createClient } from '@supabase/supabase-js';
import { getWeekKey } from './week.js';

// Stockage par serveur dans Supabase (table kayoshi_store) + cache en mémoire.
// L'API publique reste SYNCHRONE : le cache est chargé au démarrage via initStore(),
// et chaque écriture est répercutée en base (upsert) de façon asynchrone/débattue.
const TABLE = 'kayoshi_store';
let supabase = null;
let cache = {};
let flushTimer = null;
const dirty = new Set();

// Statistiques (s?u, s?t, s?m, s?v) : une ligne à part par serveur, « stats:<guildId> »,
// hors du cache principal et sauvegardée moins souvent (les compteurs changent à chaque message).
const STATS_PREFIX = 'stats:';
const STATS_FLUSH_MS = 120_000;
let statsCache = {};
let statsTimer = null;
const statsDirty = new Set();

// À appeler UNE FOIS au démarrage (avant client.login).
export async function initStore() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_KEY sont requis dans .env');
  supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.from(TABLE).select('guild_id, data');
  if (error) throw error;
  cache = {};
  statsCache = {};
  for (const row of data) {
    if (row.guild_id.startsWith(STATS_PREFIX)) statsCache[row.guild_id.slice(STATS_PREFIX.length)] = row.data ?? {};
    else cache[row.guild_id] = row.data ?? {};
  }
  migrateGreetEmbeds();
  mergeSharedFamilies();
  console.log(`🗄️  Store chargé depuis Supabase (${Object.keys(cache).length} serveur(s)).`);
}

function load() {
  return cache;
}

// N'écrit en base QUE le(s) serveur(s) modifié(s). Si guildId est fourni, seul
// ce serveur est marqué « à sauvegarder » — évite de ré-uploader toute la base
// à chaque écriture (grosse économie de bande passante sortante).
function save(data, guildId) {
  cache = data;
  if (guildId) dirty.add(guildId);
  else for (const gid of Object.keys(cache)) dirty.add(gid);
  scheduleFlush();
}

// Délai d'écriture allongé : les rafales d'écritures (ex. beaucoup de messages)
// sont regroupées en une seule sauvegarde. flushStore() garantit l'écriture à l'arrêt.
function scheduleFlush() {
  if (!supabase || flushTimer) return;
  flushTimer = setTimeout(() => flush().catch((e) => console.error(e)), 15_000);
}

async function flush() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!supabase || dirty.size === 0) return;
  const rows = [...dirty].map((guild_id) => ({ guild_id, data: cache[guild_id] ?? {}, updated_at: new Date().toISOString() }));
  dirty.clear();
  const { error } = await supabase.from(TABLE).upsert(rows);
  if (error) {
    console.error('Erreur flush Supabase:', error.message);
    for (const r of rows) dirty.add(r.guild_id);
    scheduleFlush();
  }
}

// Force l'écriture immédiate des données en attente (arrêt propre du bot).
export async function flushStore() {
  await Promise.all([flush(), flushStats()]);
}

// --- Statistiques : données modifiées en place par stats.js, puis markStatsDirty() ---
export function getStatsData(guildId) {
  return (statsCache[guildId] ??= {});
}

export function markStatsDirty(guildId) {
  statsDirty.add(guildId);
  if (supabase && !statsTimer) statsTimer = setTimeout(() => flushStats().catch((e) => console.error(e)), STATS_FLUSH_MS);
}

async function flushStats() {
  if (statsTimer) {
    clearTimeout(statsTimer);
    statsTimer = null;
  }
  if (!supabase || statsDirty.size === 0) return;
  const rows = [...statsDirty].map((id) => ({
    guild_id: STATS_PREFIX + id,
    data: statsCache[id] ?? {},
    updated_at: new Date().toISOString(),
  }));
  statsDirty.clear();
  const { error } = await supabase.from(TABLE).upsert(rows);
  if (error) {
    console.error('Erreur flush stats Supabase:', error.message);
    for (const r of rows) markStatsDirty(r.guild_id.slice(STATS_PREFIX.length));
  }
}

export function getGuildConfig(guildId) {
  return load()[guildId] ?? {};
}

export function setGuildConfig(guildId, patch) {
  const data = load();
  data[guildId] = { ...(data[guildId] ?? {}), ...patch };
  save(data, guildId);
  return data[guildId];
}

// Marque le début du suivi pour un serveur (départs comptés à partir de là).
export function ensureTracking(guildId) {
  const data = load();
  const g = data[guildId] ?? {};
  if (!g.trackingSince) {
    g.trackingSince = Date.now();
    data[guildId] = g;
    save(data);
  }
}

// Enregistre une arrivée ('join') ou un départ ('leave').
export function addMemberEvent(guildId, type, userId) {
  const data = load();
  const g = data[guildId] ?? {};
  g.memberEvents = g.memberEvents ?? [];
  g.memberEvents.push({ t: type, u: userId, ts: Date.now() });
  // Borne la taille : on garde les 5000 derniers événements (évite que le blob
  // sauvegardé grossisse indéfiniment → moins de bande passante).
  if (g.memberEvents.length > 5000) g.memberEvents = g.memberEvents.slice(-5000);
  if (!g.trackingSince) g.trackingSince = Date.now();
  data[guildId] = g;
  save(data, guildId);
}

// --- Suivi des invitations ---
// Chaque parrain a des stats { real, left, bonus } :
//   real  = membres invités toujours présents
//   left  = membres invités qui ont ensuite quitté
//   bonus = invitations ajoutées manuellement (réservé à un usage futur)
// Le total affiché = real + bonus.

// Récupère (et migre depuis l'ancien compteur simple) l'objet stats d'un parrain.
function statsFor(g, userId) {
  g.inviteStats = g.inviteStats ?? {};
  if (!g.inviteStats[userId]) {
    g.inviteStats[userId] = { real: g.inviteCounts?.[userId] ?? 0, left: 0, bonus: 0 };
  }
  const s = g.inviteStats[userId];
  s.real = s.real ?? 0;
  s.left = s.left ?? 0;
  s.bonus = s.bonus ?? 0;
  return s;
}

// Stats en lecture seule d'un parrain.
export function getInviteStats(guildId, userId) {
  const g = getGuildConfig(guildId);
  const s = g.inviteStats?.[userId];
  if (s) return { real: s.real ?? 0, left: s.left ?? 0, bonus: s.bonus ?? 0 };
  return { real: g.inviteCounts?.[userId] ?? 0, left: 0, bonus: 0 };
}

// Total affiché (real + bonus) d'un parrain.
export function getInviteTotal(guildId, userId) {
  const s = getInviteStats(guildId, userId);
  return s.real + s.bonus;
}

// Crédite une arrivée à un parrain et retient qui a invité le nouveau membre
// ainsi que le lien (code) utilisé, pour pouvoir l'afficher à son départ.
export function recordInviteJoin(guildId, inviterId, joinerId, code = null) {
  const data = load();
  const g = data[guildId] ?? {};
  const s = statsFor(g, inviterId);
  s.real += 1;
  g.invitedBy = g.invitedBy ?? {};
  g.invitedBy[joinerId] = { inviterId, code };
  data[guildId] = g;
  save(data, guildId);
  return s.real + s.bonus;
}

// Décompte un départ : si on connaît le parrain du partant, real-1 et left+1.
// Renvoie { inviterId, code, total } ou null si le parrain est inconnu.
export function recordInviteLeave(guildId, leaverId) {
  const data = load();
  const g = data[guildId];
  const entry = g?.invitedBy?.[leaverId];
  if (!entry) return null;
  // Compat : ancien format = simple chaîne (inviterId sans code).
  const inviterId = typeof entry === 'string' ? entry : entry.inviterId;
  const code = typeof entry === 'string' ? null : entry.code ?? null;
  delete g.invitedBy[leaverId];
  const s = statsFor(g, inviterId);
  if (s.real > 0) s.real -= 1;
  s.left += 1;
  data[guildId] = g;
  save(data, guildId);
  return { inviterId, code, total: s.real + s.bonus };
}

// Ajoute (ou retire, si n < 0) des invitations bonus à un membre.
// Renvoie { bonus, total } après application.
export function addBonusInvites(guildId, userId, n) {
  const data = load();
  const g = data[guildId] ?? {};
  const s = statsFor(g, userId);
  s.bonus += n;
  data[guildId] = g;
  save(data);
  return { bonus: s.bonus, total: s.real + s.bonus };
}

// Classement des parrains d'un serveur, trié par total décroissant.
// Renvoie [{ userId, real, left, bonus, total }].
export function getInviteLeaderboard(guildId) {
  const g = getGuildConfig(guildId);
  const ids = new Set([...Object.keys(g.inviteStats ?? {}), ...Object.keys(g.inviteCounts ?? {})]);
  const rows = [];
  for (const userId of ids) {
    const s = getInviteStats(guildId, userId);
    const total = s.real + s.bonus;
    if (total > 0 || s.left > 0) rows.push({ userId, ...s, total });
  }
  return rows.sort((a, b) => b.total - a.total || b.real - a.real);
}

// Instantané des totaux d'invitations de tous les parrains (base pour les
// giveaways à condition d'invitations « depuis le début »).
export function snapshotInviteTotals(guildId) {
  const g = getGuildConfig(guildId);
  const ids = new Set([...Object.keys(g.inviteStats ?? {}), ...Object.keys(g.inviteCounts ?? {})]);
  const out = {};
  for (const id of ids) out[id] = getInviteTotal(guildId, id);
  return out;
}

// Salon dédié au suivi des invitations (configuré via /inviteconfig).
export function getInviteLogChannel(guildId) {
  return getGuildConfig(guildId).inviteLogChannelId ?? null;
}

export function setInviteLogChannel(guildId, channelId) {
  return setGuildConfig(guildId, { inviteLogChannelId: channelId });
}

// Paliers de récompense (invitrank) : liste de { count, roleId }, triée croissant.
export function getInviteRanks(guildId) {
  return getGuildConfig(guildId).inviteRanks ?? [];
}

export function setInviteRanks(guildId, ranks) {
  const sorted = [...ranks].sort((a, b) => a.count - b.count);
  setGuildConfig(guildId, { inviteRanks: sorted });
  return sorted;
}

// Nombre d'arrivées enregistrées pour un membre (inclut l'arrivée courante).
export function countJoins(guildId, userId) {
  const events = getGuildConfig(guildId).memberEvents ?? [];
  return events.reduce((n, e) => (e.t === 'join' && e.u === userId ? n + 1 : n), 0);
}

// --- Avertissements (warns) ---
export function getWarns(guildId, userId) {
  return getGuildConfig(guildId).warns?.[userId] ?? [];
}

export function addWarn(guildId, userId, { reason, moderatorId }) {
  const data = load();
  const g = data[guildId] ?? {};
  g.warns = g.warns ?? {};
  const list = g.warns[userId] ?? [];
  const id = (list.reduce((max, w) => Math.max(max, w.id), 0) || 0) + 1;
  const warn = { id, reason, moderatorId, ts: Date.now() };
  list.push(warn);
  g.warns[userId] = list;
  data[guildId] = g;
  save(data);
  return { warn, warns: list };
}

export function removeWarn(guildId, userId, warnId) {
  const data = load();
  const g = data[guildId] ?? {};
  const list = g.warns?.[userId] ?? [];
  const next = list.filter((w) => w.id !== warnId);
  if (next.length === list.length) return false;
  g.warns[userId] = next;
  data[guildId] = g;
  save(data);
  return true;
}

export function clearWarns(guildId, userId) {
  const data = load();
  const g = data[guildId] ?? {};
  if (!g.warns?.[userId]) return 0;
  const count = g.warns[userId].length;
  delete g.warns[userId];
  data[guildId] = g;
  save(data);
  return count;
}

// --- Casier : sanctions données par le bot (/casier) ---
// sanctions = { userId: [{ type, reason, by, at, duration }] } : 50 dernières par membre.
// (Les avertissements restent dans warns.)
export function getSanctions(guildId, userId) {
  return getGuildConfig(guildId).sanctions?.[userId] ?? [];
}

// Sanctions et avertissements de tous les membres : { userId: [...] }.
export function getAllSanctions(guildId) {
  return getGuildConfig(guildId).sanctions ?? {};
}

export function getAllWarns(guildId) {
  return getGuildConfig(guildId).warns ?? {};
}

export function addSanction(guildId, userId, record) {
  const all = getGuildConfig(guildId).sanctions ?? {};
  setGuildConfig(guildId, { sanctions: { ...all, [userId]: [...(all[userId] ?? []), record].slice(-50) } });
}

// --- Économie automatique (/configeconomie) ---
// moneyDrops = { enabled, channelIds, min, max, everyMin } : argent à ramasser dans les salons actifs.
// weeklyTop = { enabled, channelId, roleId, rewards: { m1, m2, m3, v1, v2, v3 }, lastWeek } :
//   récompenses du lundi pour le top 3 messages et le top 3 vocal ; lastWeek = lundi de la
//   dernière semaine récompensée (« 2026-10-19 »).
export function getMoneyDrops(guildId) {
  return getGuildConfig(guildId).moneyDrops ?? null;
}

export function setMoneyDrops(guildId, cfg) {
  setGuildConfig(guildId, { moneyDrops: cfg });
}

export function getWeeklyTop(guildId) {
  return getGuildConfig(guildId).weeklyTop ?? null;
}

export function setWeeklyTop(guildId, cfg) {
  setGuildConfig(guildId, { weeklyTop: cfg });
}

// --- Quêtes de la semaine (/quetes) ---
// quests = [{ id, type, target, money, levels }] (types : messages, vocal en minutes, drops, daily).
// questWeek = { week, done: { userId: [questId] }, counts: { userId: { drops, daily } } } : semaine en
// cours (lundi, « 2026-10-26 ») ; tout repart à zéro quand la semaine change.
export function getQuests(guildId) {
  return getGuildConfig(guildId).quests ?? [];
}

export function setQuests(guildId, quests) {
  setGuildConfig(guildId, { quests });
}

export function getQuestWeek(guildId, week) {
  const qw = getGuildConfig(guildId).questWeek;
  return qw?.week === week ? qw : { week, done: {}, counts: {} };
}

export function setQuestWeek(guildId, questWeek) {
  setGuildConfig(guildId, { questWeek });
}

// --- Comptage (/compteur) ---
// counting = { channelId, current, record, lastUserId } ; nombres gardés en texte (sans limite de taille).
export function getCounting(guildId) {
  return getGuildConfig(guildId).counting ?? null;
}

export function setCounting(guildId, counting) {
  setGuildConfig(guildId, { counting });
}

// --- Bans temporaires (déban programmé) ---
export function addTempBan(guildId, userId, unbanAt) {
  const data = load();
  const g = data[guildId] ?? {};
  g.tempBans = (g.tempBans ?? []).filter((b) => b.userId !== userId);
  g.tempBans.push({ userId, unbanAt });
  data[guildId] = g;
  save(data);
}

export function removeTempBan(guildId, userId) {
  const data = load();
  const g = data[guildId];
  if (!g?.tempBans) return;
  g.tempBans = g.tempBans.filter((b) => b.userId !== userId);
  save(data);
}

// --- Rôles temporaires (/roletempo) ---
// tempRoles = [{ userId, roleId, removeAt, by }] : rôle retiré à removeAt.
const sameTempRole = (r, userId, roleId) => r.userId === userId && r.roleId === roleId;

export function getTempRole(guildId, userId, roleId) {
  return (getGuildConfig(guildId).tempRoles ?? []).find((r) => sameTempRole(r, userId, roleId)) ?? null;
}

export function setTempRole(guildId, record) {
  const others = (getGuildConfig(guildId).tempRoles ?? []).filter((r) => !sameTempRole(r, record.userId, record.roleId));
  setGuildConfig(guildId, { tempRoles: [...others, record] });
}

export function removeTempRole(guildId, userId, roleId) {
  const list = getGuildConfig(guildId).tempRoles ?? [];
  if (!list.some((r) => sameTempRole(r, userId, roleId))) return;
  setGuildConfig(guildId, { tempRoles: list.filter((r) => !sameTempRole(r, userId, roleId)) });
}

// Rôles temporaires arrivés à échéance, tous serveurs confondus.
export function getDueTempRoles() {
  const now = Date.now();
  return Object.entries(load()).flatMap(([guildId, g]) => (g.tempRoles ?? []).filter((r) => r.removeAt <= now).map((r) => ({ guildId, ...r })));
}

// Renvoie tous les bans temporaires arrivés à échéance, tous serveurs confondus.
export function getDueTempBans() {
  const data = load();
  const now = Date.now();
  const due = [];
  for (const [guildId, g] of Object.entries(data)) {
    for (const b of g.tempBans ?? []) {
      if (b.unbanAt <= now) due.push({ guildId, ...b });
    }
  }
  return due;
}

// --- Système de tickets ---
// `key` permet plusieurs systèmes indépendants (ticketConfig, ticketConfig2…).
export function getTicketConfig(guildId, key = 'ticketConfig') {
  return getGuildConfig(guildId)[key] ?? null;
}

export function setTicketConfig(guildId, ticketConfig, key = 'ticketConfig') {
  return setGuildConfig(guildId, { [key]: ticketConfig });
}

// Réserve et renvoie le prochain numéro de ticket (incrémental).
export function reserveTicketNumber(guildId, key = 'ticketConfig') {
  const data = load();
  const tc = data[guildId]?.[key];
  if (!tc) return null;
  tc.counter = (tc.counter ?? 0) + 1;
  save(data, guildId);
  return tc.counter;
}

export function saveTicketRecord(guildId, channelId, record, key = 'ticketConfig') {
  const data = load();
  const tc = data[guildId]?.[key];
  if (!tc) return;
  tc.tickets = tc.tickets ?? {};
  tc.tickets[channelId] = record;
  save(data, guildId);
}

export function getTicketRecord(guildId, channelId, key = 'ticketConfig') {
  return getGuildConfig(guildId)[key]?.tickets?.[channelId] ?? null;
}

export function updateTicketRecord(guildId, channelId, patch, key = 'ticketConfig') {
  const data = load();
  const tc = data[guildId]?.[key];
  if (!tc?.tickets?.[channelId]) return null;
  tc.tickets[channelId] = { ...tc.tickets[channelId], ...patch };
  save(data, guildId);
  return tc.tickets[channelId];
}

export function deleteTicketRecord(guildId, channelId, key = 'ticketConfig') {
  const data = load();
  const tc = data[guildId]?.[key];
  if (!tc?.tickets?.[channelId]) return;
  delete tc.tickets[channelId];
  save(data, guildId);
}

// --- Avis sur les tickets (/avisticket) ---
export function getAvisConfig(guildId) {
  return getGuildConfig(guildId).avisConfig ?? null;
}

export function setAvisConfig(guildId, avisConfig) {
  return setGuildConfig(guildId, { avisConfig });
}

// Salon des avis d'un système de tickets (1 ou 2), null = avis désactivés.
// avisConfig = { channels: { 1: id|null, 2: id|null } } ; l'ancien format
// { channelId } valait pour les deux systèmes.
export function getAvisChannel(guildId, slot) {
  const c = getAvisConfig(guildId);
  if (!c) return null;
  if (c.channels) return c.channels[slot] ?? null;
  return c.channelId ?? null;
}

export function setAvisChannel(guildId, slots, channelId) {
  const channels = { 1: getAvisChannel(guildId, 1), 2: getAvisChannel(guildId, 2) };
  for (const slot of slots) channels[slot] = channelId;
  return setAvisConfig(guildId, { channels });
}

// Avis indexés par numéro de ticket : { userId, motifLabel, rating, comment, messageId }.
export function getAvisReview(guildId, number) {
  return getGuildConfig(guildId).avisReviews?.[number] ?? null;
}

export function saveAvisReview(guildId, number, patch) {
  const data = load();
  const g = data[guildId] ?? {};
  g.avisReviews = g.avisReviews ?? {};
  g.avisReviews[number] = { ...(g.avisReviews[number] ?? {}), ...patch };
  data[guildId] = g;
  save(data, guildId);
  return g.avisReviews[number];
}

// --- Vérification anti-bot (captcha) ---
export function getVerifConfig(guildId) {
  return getGuildConfig(guildId).verifConfig ?? null;
}

export function setVerifConfig(guildId, verifConfig) {
  return setGuildConfig(guildId, { verifConfig });
}

// --- Rôle selon le statut personnalisé (ex: invite du serveur dans le statut) ---
// Config : { text: string déclencheur, roleId: string }.
export function getStatusRoleConfig(guildId) {
  return getGuildConfig(guildId).statusRole ?? null;
}

export function setStatusRoleConfig(guildId, statusRole) {
  return setGuildConfig(guildId, { statusRole });
}

// --- Rôle selon le tag du serveur (/tagrole) ---
// tagRole = { roleId }
export function getTagRoleConfig(guildId) {
  return getGuildConfig(guildId).tagRole ?? null;
}

export function setTagRoleConfig(guildId, tagRole) {
  return setGuildConfig(guildId, { tagRole });
}

// --- Rôles selon le statut : plusieurs mots-clés (/statut) ---
// statutRules = [{ keyword, roleId }]
export function getStatutRules(guildId) {
  return getGuildConfig(guildId).statutRules ?? [];
}

export function addStatutRule(guildId, keyword, roleId) {
  const data = load();
  const g = data[guildId] ?? {};
  g.statutRules = g.statutRules ?? [];
  const kw = keyword.toLowerCase();
  if (g.statutRules.some((r) => r.keyword === kw && r.roleId === roleId)) return false;
  g.statutRules.push({ keyword: kw, roleId });
  data[guildId] = g;
  save(data);
  return true;
}

export function removeStatutRule(guildId, keyword, roleId = null) {
  const data = load();
  const g = data[guildId];
  if (!g?.statutRules?.length) return 0;
  const kw = keyword.toLowerCase();
  const before = g.statutRules.length;
  g.statutRules = g.statutRules.filter((r) => !(r.keyword === kw && (roleId ? r.roleId === roleId : true)));
  const removed = before - g.statutRules.length;
  if (removed) save(data);
  return removed;
}

// --- Rôles incompatibles (/antirole) ---
// antiRoles = [{ keepRoleId, removeRoleId }] : si le membre a keepRoleId,
// removeRoleId lui est retiré.
export function getAntiRoleRules(guildId) {
  return getGuildConfig(guildId).antiRoles ?? [];
}

export function addAntiRoleRule(guildId, keepRoleId, removeRoleId) {
  const data = load();
  const g = data[guildId] ?? {};
  g.antiRoles = g.antiRoles ?? [];
  if (g.antiRoles.some((r) => r.keepRoleId === keepRoleId && r.removeRoleId === removeRoleId)) return false;
  g.antiRoles.push({ keepRoleId, removeRoleId });
  data[guildId] = g;
  save(data, guildId);
  return true;
}

export function removeAntiRoleRule(guildId, keepRoleId, removeRoleId) {
  const data = load();
  const g = data[guildId];
  if (!g?.antiRoles?.length) return false;
  const before = g.antiRoles.length;
  g.antiRoles = g.antiRoles.filter((r) => !(r.keepRoleId === keepRoleId && r.removeRoleId === removeRoleId));
  if (g.antiRoles.length === before) return false;
  save(data, guildId);
  return true;
}

// --- Pseudos verrouillés (/lockpseudo) ---
// nickLocks = { [userId]: { nick, by, at } } : le membre garde ce pseudo,
// seul le staff peut le changer. Conservé si le membre quitte le serveur.
export function getNickLocks(guildId) {
  return getGuildConfig(guildId).nickLocks ?? {};
}

export function getNickLock(guildId, userId) {
  return getNickLocks(guildId)[userId] ?? null;
}

export function setNickLock(guildId, userId, lock) {
  setGuildConfig(guildId, { nickLocks: { ...getNickLocks(guildId), [userId]: lock } });
}

export function removeNickLock(guildId, userId) {
  const locks = { ...getNickLocks(guildId) };
  if (!locks[userId]) return false;
  delete locks[userId];
  setGuildConfig(guildId, { nickLocks: locks });
  return true;
}

// --- Confessions anonymes (/configconfessions) ---
// confessions = { channelId, logChannelId, count, authors } : salon des confessions, salon des logs
// (auteur visible du staff), dernier numéro attribué, et auteur de chaque confession
// ({ messageId: userId }, jamais affiché aux membres) pour le prévenir en MP quand on lui répond.
const MAX_CONFESSION_AUTHORS = 1000;

export function getConfessionConfig(guildId) {
  return getGuildConfig(guildId).confessions ?? null;
}

export function getConfessionAuthor(guildId, messageId) {
  return getConfessionConfig(guildId)?.authors?.[messageId] ?? null;
}

// Garde les 1000 dernières confessions (les plus anciennes sont oubliées).
export function setConfessionAuthor(guildId, messageId, userId) {
  const cfg = getConfessionConfig(guildId) ?? {};
  const authors = { ...(cfg.authors ?? {}), [messageId]: userId };
  for (const old of Object.keys(authors).slice(0, -MAX_CONFESSION_AUTHORS)) delete authors[old];
  setGuildConfig(guildId, { confessions: { ...cfg, authors } });
}

export function setConfessionChannels(guildId, channelId, logChannelId) {
  setGuildConfig(guildId, { confessions: { count: 0, ...getConfessionConfig(guildId), channelId, logChannelId } });
}

// Réserve le numéro de la prochaine confession.
export function nextConfessionNumber(guildId) {
  const cfg = getConfessionConfig(guildId) ?? {};
  const number = (cfg.count ?? 0) + 1;
  setGuildConfig(guildId, { confessions: { ...cfg, count: number } });
  return number;
}

// --- Message GIF sans perm image (/messimage) ---
// gifHint = { message, ignoredRoleIds: [roleId] }
export function getGifHint(guildId) {
  return getGuildConfig(guildId).gifHint ?? null;
}

export function setGifHint(guildId, gifHint) {
  return setGuildConfig(guildId, { gifHint });
}

// --- Annonces de rank (/configrank, /rank) ---
// rankConfig = { channelId, message }
export function getRankConfig(guildId) {
  return getGuildConfig(guildId).rankConfig ?? null;
}

export function setRankConfig(guildId, rankConfig) {
  return setGuildConfig(guildId, { rankConfig });
}

// --- Filtre anti-liens ---
export function getLinkConfig(guildId) {
  return getGuildConfig(guildId).linkConfig ?? null;
}

export function setLinkConfig(guildId, linkConfig) {
  return setGuildConfig(guildId, { linkConfig });
}

// --- Vocaux temporaires (Join to Create) ---
export function getVoiceConfig(guildId) {
  return getGuildConfig(guildId).voiceConfig ?? null;
}

export function setVoiceConfig(guildId, voiceConfig) {
  return setGuildConfig(guildId, { voiceConfig });
}

export function addTempVoice(guildId, channelId, ownerId) {
  const data = load();
  const g = data[guildId] ?? {};
  g.voiceConfig = g.voiceConfig ?? {};
  g.voiceConfig.temp = g.voiceConfig.temp ?? {};
  g.voiceConfig.temp[channelId] = { ownerId };
  data[guildId] = g;
  save(data);
}

export function getTempVoice(guildId, channelId) {
  return getGuildConfig(guildId).voiceConfig?.temp?.[channelId] ?? null;
}

export function updateTempVoice(guildId, channelId, patch) {
  const data = load();
  const temp = data[guildId]?.voiceConfig?.temp;
  if (!temp?.[channelId]) return;
  temp[channelId] = { ...temp[channelId], ...patch };
  save(data);
}

export function removeTempVoice(guildId, channelId) {
  const data = load();
  const temp = data[guildId]?.voiceConfig?.temp;
  if (!temp?.[channelId]) return;
  delete temp[channelId];
  save(data);
}

export function getAllTempVoice(guildId) {
  return getGuildConfig(guildId).voiceConfig?.temp ?? {};
}

// --- Messages de bienvenue / départ ---
// type = 'welcome' | 'leave'
export function getGreetConfig(guildId, type) {
  return getGuildConfig(guildId).greetConfig?.[type] ?? null;
}

export function setGreetConfig(guildId, type, cfg) {
  const data = load();
  const g = data[guildId] ?? {};
  g.greetConfig = g.greetConfig ?? {};
  g.greetConfig[type] = cfg;
  data[guildId] = g;
  save(data);
  return cfg;
}

// --- Embed de bienvenue / départ (/embed), indépendant du message texte ---
// data[guildId].greetEmbed = { welcome|leave: { channelId, embed } }
export function getGreetEmbed(guildId, type) {
  return getGuildConfig(guildId).greetEmbed?.[type] ?? null;
}

// cfg null = désactive l'embed.
export function setGreetEmbed(guildId, type, cfg) {
  const data = load();
  const g = data[guildId] ?? {};
  g.greetEmbed = g.greetEmbed ?? {};
  if (cfg) g.greetEmbed[type] = cfg;
  else delete g.greetEmbed[type];
  data[guildId] = g;
  save(data, guildId);
  return cfg;
}

// Ancien format : l'embed était stocké dans greetConfig[type].embed (et
// remplaçait le message texte). On le déplace vers greetEmbed[type].
function migrateGreetEmbeds() {
  for (const [guildId, g] of Object.entries(cache)) {
    for (const [type, c] of Object.entries(g.greetConfig ?? {})) {
      if (!c?.embed) continue;
      g.greetEmbed = g.greetEmbed ?? {};
      g.greetEmbed[type] = g.greetEmbed[type] ?? { channelId: c.channelId, embed: c.embed };
      delete c.embed;
      dirty.add(guildId);
    }
  }
  if (dirty.size) scheduleFlush();
}

// --- Famille virtuelle (/marry, /divorce, /adopt, /renier, /fuguer, /family) ---
// family = { spouses: { userId: [conjointIds] } (symétrique, plusieurs mariages possibles),
//            parent: { enfantId: parentId }, children: { parentId: [enfantIds] },
//            since: { "a-b": timestamp } (date de mariage, clé triée) }
// Ancien format (un seul conjoint) : spouse: { userId: conjointId }, converti à la lecture.

// Famille partagée : l'ancien serveur (Ichima) lit et écrit celle du nouveau (Hanami), pour que
// les mariages et adoptions faits d'un côté se voient de l'autre.
const FAMILY_SHARED_WITH = { '1201199956707516476': '1563159382361907350' };
const familyGuild = (guildId) => FAMILY_SHARED_WITH[guildId] ?? guildId;

function normalizeFamily(f = {}) {
  const spouses = f.spouses ?? Object.fromEntries(Object.entries(f.spouse ?? {}).map(([id, other]) => [id, [other]]));
  return { spouses, parent: f.parent ?? {}, children: f.children ?? {}, since: f.since ?? {} };
}

export function getFamily(guildId) {
  return normalizeFamily(getGuildConfig(familyGuild(guildId)).family);
}

function saveFamily(guildId, f) {
  setGuildConfig(familyGuild(guildId), { family: f });
}

// Au démarrage : la famille propre à l'ancien serveur (d'avant le partage) est fusionnée dans
// celle du nouveau, puis gardée de côté (familyBeforeMerge) sans plus être utilisée.
// En cas de conflit, le nouveau serveur l'emporte (parent adoptif déjà défini, boucle d'adoption).
function mergeSharedFamilies() {
  for (const [oldId, newId] of Object.entries(FAMILY_SHARED_WITH)) {
    const old = cache[oldId]?.family;
    if (!old) continue;
    const source = normalizeFamily(old);
    const target = normalizeFamily(cache[newId]?.family);
    for (const [user, spouses] of Object.entries(source.spouses)) {
      target.spouses[user] = [...new Set([...(target.spouses[user] ?? []), ...spouses])];
    }
    for (const [key, at] of Object.entries(source.since)) target.since[key] = Math.min(target.since[key] ?? at, at);
    let adoptions = 0;
    for (const [child, parent] of Object.entries(source.parent)) {
      if (target.parent[child]) continue;
      // Boucle si l'enfant est déjà un ancêtre du parent.
      let ancestor = parent;
      const seen = new Set();
      while (ancestor && ancestor !== child && !seen.has(ancestor)) {
        seen.add(ancestor);
        ancestor = target.parent[ancestor];
      }
      if (ancestor === child) continue;
      target.parent[child] = parent;
      target.children[parent] = [...new Set([...(target.children[parent] ?? []), child])];
      adoptions++;
    }
    delete cache[oldId].family;
    setGuildConfig(oldId, { familyBeforeMerge: old });
    setGuildConfig(newId, { family: target });
    console.log(`👪 Famille de ${oldId} fusionnée dans ${newId} (${Object.keys(source.spouses).length} marié(s), ${adoptions} adoption(s)).`);
  }
}

const pairKey = (a, b) => [a, b].sort().join('-');

// Relations d'un membre : conjoints, parent adoptif, enfants adoptés.
export function getRelations(guildId, userId) {
  const f = getFamily(guildId);
  return { spouses: f.spouses[userId] ?? [], parent: f.parent[userId] ?? null, children: f.children[userId] ?? [], since: f.since };
}

export function marry(guildId, a, b) {
  const f = getFamily(guildId);
  f.spouses[a] = [...(f.spouses[a] ?? []).filter((id) => id !== b), b];
  f.spouses[b] = [...(f.spouses[b] ?? []).filter((id) => id !== a), a];
  f.since[pairKey(a, b)] = Date.now();
  saveFamily(guildId, f);
}

// Annule le mariage entre `userId` et `spouseId`. Renvoie true s'ils étaient mariés.
export function divorce(guildId, userId, spouseId) {
  const f = getFamily(guildId);
  if (!(f.spouses[userId] ?? []).includes(spouseId)) return false;
  for (const [a, b] of [[userId, spouseId], [spouseId, userId]]) {
    f.spouses[a] = (f.spouses[a] ?? []).filter((id) => id !== b);
    if (!f.spouses[a].length) delete f.spouses[a];
  }
  delete f.since[pairKey(userId, spouseId)];
  saveFamily(guildId, f);
  return true;
}

export function adopt(guildId, parentId, childId) {
  const f = getFamily(guildId);
  f.parent[childId] = parentId;
  f.children[parentId] = [...(f.children[parentId] ?? []).filter((id) => id !== childId), childId];
  saveFamily(guildId, f);
}

// Défait un lien d'adoption (dans un sens ou l'autre). Renvoie true si un lien existait.
export function removeAdoption(guildId, parentId, childId) {
  const f = getFamily(guildId);
  if (f.parent[childId] !== parentId) return false;
  delete f.parent[childId];
  f.children[parentId] = (f.children[parentId] ?? []).filter((id) => id !== childId);
  if (!f.children[parentId].length) delete f.children[parentId];
  saveFamily(guildId, f);
  return true;
}

// --- Tu préfères (/tu-preferes) : votes en cours, par message ---
// wyr = { messageId: { channelId, a, b, endsAt, votes: { userId: 'a' | 'b' } } }
export function getWyr(guildId, messageId) {
  return getGuildConfig(guildId).wyr?.[messageId] ?? null;
}

export function saveWyr(guildId, messageId, poll) {
  setGuildConfig(guildId, { wyr: { ...getGuildConfig(guildId).wyr, [messageId]: poll } });
}

export function deleteWyr(guildId, messageId) {
  const { [messageId]: removed, ...rest } = getGuildConfig(guildId).wyr ?? {};
  if (removed) setGuildConfig(guildId, { wyr: rest });
}

export function getAllWyr() {
  return Object.entries(load()).flatMap(([guildId, g]) =>
    Object.entries(g.wyr ?? {}).map(([messageId, poll]) => ({ guildId, messageId, poll })),
  );
}

// --- Devine le drapeau (/guessflag) ---
// guessFlag = { channelId, messageId, current: { code, since },
//               last: { code, by: 'guess' | 'skip', userId, at }, recent: [codes], scores: { userId: n } }
export function getGuessFlag(guildId) {
  return getGuildConfig(guildId).guessFlag ?? null;
}

export function patchGuessFlag(guildId, patch) {
  return setGuildConfig(guildId, { guessFlag: { ...(getGuessFlag(guildId) ?? {}), ...patch } }).guessFlag;
}

// --- Message privé envoyé à chaque arrivée (/dmjoin) ---
// dmJoin = { message } (templates de /bienvenue), null = désactivé.
export function getDmJoin(guildId) {
  return getGuildConfig(guildId).dmJoin ?? null;
}

export function setDmJoin(guildId, dmJoin) {
  return setGuildConfig(guildId, { dmJoin });
}

// --- Classement d'activité hebdomadaire (/configstat) ---
// Salon + message à mettre à jour : { channelId, messageId }.
export function getStatConfig(guildId) {
  return getGuildConfig(guildId).statConfig ?? null;
}

export function setStatConfig(guildId, statConfig) {
  return setGuildConfig(guildId, { statConfig });
}

// Met à jour partiellement la config stats (sans écraser le reste).
export function patchStatConfig(guildId, patch) {
  const data = load();
  const g = data[guildId] ?? {};
  g.statConfig = { ...(g.statConfig ?? {}), ...patch };
  data[guildId] = g;
  save(data);
  return g.statConfig;
}

// Ajoute des secondes de présence vocale pour la semaine courante.
export function bumpVoiceActivity(guildId, userId, seconds) {
  if (!seconds || seconds <= 0) return;
  const data = load();
  const g = data[guildId] ?? {};
  const wk = getWeekKey();
  if (!g.voiceActivity || g.voiceActivity.weekKey !== wk) g.voiceActivity = { weekKey: wk, counts: {} };
  g.voiceActivity.counts[userId] = (g.voiceActivity.counts[userId] ?? 0) + Math.round(seconds);
  data[guildId] = g;
  save(data, guildId);
}

// Top membres vocaux de la semaine courante : [{ userId, seconds }].
export function getVoiceLeaderboard(guildId, limit = 10) {
  const g = getGuildConfig(guildId);
  if (!g.voiceActivity || g.voiceActivity.weekKey !== getWeekKey()) return [];
  return Object.entries(g.voiceActivity.counts ?? {})
    .map(([userId, seconds]) => ({ userId, seconds }))
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, limit);
}

// Compte un message pour la semaine courante (réinitialise au changement de semaine).
export function bumpActivity(guildId, userId) {
  const data = load();
  const g = data[guildId] ?? {};
  const wk = getWeekKey();
  if (!g.activity || g.activity.weekKey !== wk) g.activity = { weekKey: wk, counts: {} };
  g.activity.counts[userId] = (g.activity.counts[userId] ?? 0) + 1;
  data[guildId] = g;
  save(data, guildId);
}

// Top membres de la semaine courante : [{ userId, count }]. Vide si nouvelle semaine.
export function getActivityLeaderboard(guildId, limit = 10) {
  const g = getGuildConfig(guildId);
  if (!g.activity || g.activity.weekKey !== getWeekKey()) return [];
  return Object.entries(g.activity.counts ?? {})
    .map(([userId, count]) => ({ userId, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// --- Anti-spam ---
// antispam = { enabled, maxMessages, intervalMs, timeoutMs, exemptRoleIds:[] }
export function getAntiSpamConfig(guildId) {
  return getGuildConfig(guildId).antispam ?? null;
}

export function setAntiSpamConfig(guildId, antispam) {
  return setGuildConfig(guildId, { antispam });
}

// --- Système de niveaux (XP) ---
// data[guildId].levels = { [userId]: xpTotale } ; levelUpChannelId, levelUpMessage ; levelRewards = { [niveau]: roleId }
export function getXp(guildId, userId) {
  return getGuildConfig(guildId).levels?.[userId] ?? 0;
}

export function setXp(guildId, userId, xp) {
  const data = load();
  const g = data[guildId] ?? {};
  g.levels = g.levels ?? {};
  g.levels[userId] = Math.max(0, Math.round(xp));
  data[guildId] = g;
  save(data, guildId);
  return g.levels[userId];
}

// Ajoute (ou retire si delta < 0) de l'XP. Renvoie { before, after } (borné à 0).
export function addXp(guildId, userId, delta) {
  const data = load();
  const g = data[guildId] ?? {};
  g.levels = g.levels ?? {};
  const before = g.levels[userId] ?? 0;
  const after = Math.max(0, before + Math.round(delta));
  g.levels[userId] = after;
  data[guildId] = g;
  save(data, guildId);
  return { before, after };
}

export function getLevelLeaderboard(guildId, limit = 10) {
  const levels = getGuildConfig(guildId).levels ?? {};
  return Object.entries(levels)
    .map(([userId, xp]) => ({ userId, xp }))
    .filter((r) => r.xp > 0)
    .sort((a, b) => b.xp - a.xp)
    .slice(0, limit);
}

export function getLevelRank(guildId, userId) {
  const levels = getGuildConfig(guildId).levels ?? {};
  const xp = levels[userId] ?? 0;
  if (xp <= 0) return null;
  let rank = 1;
  for (const [id, v] of Object.entries(levels)) if (id !== userId && v > xp) rank += 1;
  return rank;
}

// Système d'XP actif ? Activé par défaut (false seulement si désactivé explicitement).
export function getLevelsEnabled(guildId) {
  return getGuildConfig(guildId).levelsEnabled !== false;
}

export function setLevelsEnabled(guildId, enabled) {
  return setGuildConfig(guildId, { levelsEnabled: enabled });
}

export function levelUpChannelId(guildId) {
  return getGuildConfig(guildId).levelUpChannelId ?? null;
}

export function getLevelUpMessage(guildId) {
  return getGuildConfig(guildId).levelUpMessage ?? null;
}

export function setLevelUpConfig(guildId, { message, channelId }) {
  return setGuildConfig(guildId, { levelUpMessage: message, levelUpChannelId: channelId });
}

// Rôles-récompenses : levelRewards = { niveau: roleId }, levelRewardModes = { niveau: 'evolutif' }
// (absent = « addition » : le rôle est gardé aux niveaux suivants).
export function getLevelRewards(guildId) {
  return getGuildConfig(guildId).levelRewards ?? {};
}

export function getLevelRewardModes(guildId) {
  return getGuildConfig(guildId).levelRewardModes ?? {};
}

export function setLevelReward(guildId, level, roleId, mode = 'addition') {
  const data = load();
  const g = data[guildId] ?? {};
  g.levelRewards = g.levelRewards ?? {};
  g.levelRewards[level] = roleId;
  g.levelRewardModes = g.levelRewardModes ?? {};
  if (mode === 'evolutif') g.levelRewardModes[level] = 'evolutif';
  else delete g.levelRewardModes[level];
  data[guildId] = g;
  save(data, guildId);
}

// Argent donné en passant un niveau : levelMoneyRewards = { niveau: montant }.
export function getLevelMoneyRewards(guildId) {
  return getGuildConfig(guildId).levelMoneyRewards ?? {};
}

export function setLevelMoneyReward(guildId, level, amount) {
  const data = load();
  const g = data[guildId] ?? {};
  g.levelMoneyRewards = { ...(g.levelMoneyRewards ?? {}), [level]: amount };
  data[guildId] = g;
  save(data, guildId);
}

// Supprime toutes les récompenses d'un niveau (rôle et argent). Renvoie true s'il y en avait.
export function removeLevelReward(guildId, level) {
  const data = load();
  const g = data[guildId] ?? {};
  const hadRole = Boolean(g.levelRewards && level in g.levelRewards);
  const hadMoney = Boolean(g.levelMoneyRewards && level in g.levelMoneyRewards);
  if (!hadRole && !hadMoney) return false;
  if (hadRole) delete g.levelRewards[level];
  if (g.levelRewardModes) delete g.levelRewardModes[level];
  if (hadMoney) delete g.levelMoneyRewards[level];
  data[guildId] = g;
  save(data, guildId);
  return true;
}

// --- Monnaie & boutique (/shop, /add-item…) ---
// data[guildId].money = { userId: solde }
// data[guildId].shop = { items: { itemId: { name, price, description, role, createdAt } }, purchases: [ { id, userId, itemId, name, price, at } ] }
export function getMoney(guildId, userId) {
  return getGuildConfig(guildId).money?.[userId] ?? 0;
}

export function addMoney(guildId, userId, delta) {
  const data = load();
  const g = data[guildId] ?? {};
  g.money = g.money ?? {};
  const after = Math.max(0, Math.round((g.money[userId] ?? 0) + delta));
  g.money[userId] = after;
  data[guildId] = g;
  save(data, guildId);
  return after;
}

// Classement de l'argent (/argent top) : soldes > 0, du plus riche au moins riche.
export function getMoneyLeaderboard(guildId) {
  return Object.entries(getGuildConfig(guildId).money ?? {})
    .map(([userId, money]) => ({ userId, money }))
    .filter((r) => r.money > 0)
    .sort((a, b) => b.money - a.money);
}

// Récompense quotidienne (/argent daily) : data[guildId].daily = { userId: { last, streak } }.
export function getDaily(guildId, userId) {
  return getGuildConfig(guildId).daily?.[userId] ?? null;
}

export function setDaily(guildId, userId, record) {
  setGuildConfig(guildId, { daily: { ...(getGuildConfig(guildId).daily ?? {}), [userId]: record } });
}

export function setMoney(guildId, userId, amount) {
  const data = load();
  const g = data[guildId] ?? {};
  g.money = g.money ?? {};
  g.money[userId] = Math.max(0, Math.round(amount));
  data[guildId] = g;
  save(data, guildId);
  return g.money[userId];
}

// Apparence de la boutique (/configshop) : { title, description, color }.
export function getShopConfig(guildId) {
  return getGuildConfig(guildId).shop?.config ?? {};
}

export function setShopConfig(guildId, patch) {
  const data = load();
  const g = data[guildId] ?? {};
  g.shop = g.shop ?? { items: {}, purchases: [] };
  g.shop.config = { ...(g.shop.config ?? {}), ...patch };
  data[guildId] = g;
  save(data, guildId);
  return g.shop.config;
}

export function getShopItems(guildId) {
  return getGuildConfig(guildId).shop?.items ?? {};
}

export function getShopItem(guildId, itemId) {
  return getGuildConfig(guildId).shop?.items?.[itemId] ?? null;
}

export function addShopItem(guildId, item) {
  const data = load();
  const g = data[guildId] ?? {};
  g.shop = g.shop ?? { items: {}, purchases: [] };
  g.shop.items = g.shop.items ?? {};
  const id = `it${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  g.shop.items[id] = { ...item, createdAt: Date.now() };
  data[guildId] = g;
  save(data, guildId);
  return { id, ...g.shop.items[id] };
}

// Modifie les champs fournis d'un objet (nom, prix, description…). Renvoie l'objet à jour, ou null.
export function updateShopItem(guildId, itemId, patch) {
  const data = load();
  const g = data[guildId] ?? {};
  if (!g.shop?.items?.[itemId]) return null;
  g.shop.items[itemId] = { ...g.shop.items[itemId], ...patch };
  data[guildId] = g;
  save(data, guildId);
  return { id: itemId, ...g.shop.items[itemId] };
}

export function removeShopItem(guildId, itemId) {
  const data = load();
  const g = data[guildId] ?? {};
  if (!g.shop?.items?.[itemId]) return null;
  const removed = g.shop.items[itemId];
  delete g.shop.items[itemId];
  data[guildId] = g;
  save(data, guildId);
  return removed;
}

// --- Boutons « react » d'un embed (/embed) : un bouton qui affiche juste un texte ---
// Le texte (potentiellement long) est stocké ici, référencé par un id court dans le customId.
export function addReactButton(guildId, text) {
  const data = load();
  const g = data[guildId] ?? {};
  g.reactButtons = g.reactButtons ?? {};
  const id = `rb${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  g.reactButtons[id] = text;
  data[guildId] = g;
  save(data, guildId);
  return id;
}

export function getReactButtonText(guildId, id) {
  return getGuildConfig(guildId).reactButtons?.[id] ?? null;
}

const MAX_PURCHASES = 500;

export function addPurchase(guildId, record) {
  const data = load();
  const g = data[guildId] ?? {};
  g.shop = g.shop ?? { items: {}, purchases: [] };
  g.shop.purchases = [{ id: `p${Date.now().toString(36)}`, at: Date.now(), ...record }, ...(g.shop.purchases ?? [])].slice(0, MAX_PURCHASES);
  data[guildId] = g;
  save(data, guildId);
}

// Historique des achats, le plus récent d'abord, filtré par membre si userId fourni.
export function getPurchases(guildId, userId = null) {
  const all = getGuildConfig(guildId).shop?.purchases ?? [];
  return userId ? all.filter((p) => p.userId === userId) : all;
}

// --- Rôle de quarantaine persistant (ex-blacklist) ---
// data[guildId].serverBlacklist = { quarantineRoleId, sticky:[userIds] }
// Le rôle est conservé : si un membre l'a en partant, il le retrouve au retour.
export function getServerBlacklist(guildId) {
  const b = getGuildConfig(guildId).serverBlacklist;
  return { quarantineRoleId: null, sticky: [], ...(b ?? {}) };
}

function saveServerBlacklist(guildId, mutate) {
  const data = load();
  const g = data[guildId] ?? {};
  const b = { quarantineRoleId: null, sticky: [], ...(g.serverBlacklist ?? {}) };
  mutate(b);
  g.serverBlacklist = b;
  data[guildId] = g;
  save(data, guildId);
  return b;
}

export function isBlacklistSticky(guildId, userId) {
  return getServerBlacklist(guildId).sticky.includes(userId);
}

export function addBlacklistSticky(guildId, userId) {
  saveServerBlacklist(guildId, (b) => {
    if (!b.sticky.includes(userId)) b.sticky.push(userId);
  });
}

export function removeBlacklistSticky(guildId, userId) {
  saveServerBlacklist(guildId, (b) => {
    b.sticky = b.sticky.filter((id) => id !== userId);
  });
}

// --- Mode "coiffeur" (répond "feur" quand un message finit par "quoi") ---
export function getCoiffeurEnabled(guildId) {
  return getGuildConfig(guildId).coiffeur === true;
}

export function setCoiffeurEnabled(guildId, enabled) {
  return setGuildConfig(guildId, { coiffeur: Boolean(enabled) });
}

// --- Salons "one-message" (tout nouveau message y est supprimé aussitôt) ---
// Stocké sous data[guildId].oneMessage = { [channelId]: [memberId, ...] }.
// Liste vide = tous les membres ; liste non vide = seulement ces membres.
function readOneMessage(g) {
  if (g.oneMessage) return g.oneMessage;
  // Migration depuis l'ancien format (tableau de salons = tous les membres).
  if (Array.isArray(g.oneMessageChannels)) {
    const map = {};
    for (const id of g.oneMessageChannels) map[id] = [];
    return map;
  }
  return {};
}

export function getOneMessageConfig(guildId) {
  return readOneMessage(getGuildConfig(guildId));
}

export function isOneMessageChannel(guildId, channelId) {
  return channelId in getOneMessageConfig(guildId);
}

// Faut-il supprimer le message de ce membre dans ce salon ?
export function shouldDeleteOneMessage(guildId, channelId, userId) {
  const targets = getOneMessageConfig(guildId)[channelId];
  if (!targets) return false; // salon non configuré
  if (targets.length === 0) return true; // tous les membres
  return targets.includes(userId); // seulement les membres ciblés
}

// Active le mode. Sans membre : tout le salon (liste vide = tous).
// Avec membre : cible ce membre (ajouté à la liste ; remplace le mode "tous").
export function enableOneMessage(guildId, channelId, memberId = null) {
  const data = load();
  const g = data[guildId] ?? {};
  const map = readOneMessage(g);
  if (!memberId) {
    map[channelId] = [];
  } else {
    const cur = map[channelId];
    if (!cur || cur.length === 0) map[channelId] = [memberId];
    else if (!cur.includes(memberId)) cur.push(memberId);
  }
  g.oneMessage = map;
  delete g.oneMessageChannels;
  data[guildId] = g;
  save(data);
  return map[channelId];
}

// Désactive. Sans membre : tout le salon. Avec membre : retire ce membre.
// Renvoie { status } : 'not-active' | 'channel-removed' | 'member-removed' |
// 'was-all' | 'not-targeted'.
export function disableOneMessage(guildId, channelId, memberId = null) {
  const data = load();
  const g = data[guildId] ?? {};
  const map = readOneMessage(g);
  if (!(channelId in map)) return { status: 'not-active' };

  let status;
  if (!memberId) {
    delete map[channelId];
    status = 'channel-removed';
  } else {
    const cur = map[channelId];
    if (cur.length === 0) {
      status = 'was-all';
    } else if (!cur.includes(memberId)) {
      status = 'not-targeted';
    } else {
      const next = cur.filter((id) => id !== memberId);
      if (next.length === 0) {
        delete map[channelId];
        status = 'channel-removed';
      } else {
        map[channelId] = next;
        status = 'member-removed';
      }
    }
  }
  g.oneMessage = map;
  delete g.oneMessageChannels;
  data[guildId] = g;
  save(data);
  return { status };
}

// Recopie la config one-message d'un salon vers un autre (utilisé par /reset).
export function setOneMessageTargets(guildId, channelId, targets) {
  const data = load();
  const g = data[guildId] ?? {};
  const map = readOneMessage(g);
  map[channelId] = Array.isArray(targets) ? [...targets] : [];
  g.oneMessage = map;
  delete g.oneMessageChannels;
  data[guildId] = g;
  save(data);
}

// Retire complètement un salon (compat /reset).
export function removeOneMessageChannel(guildId, channelId) {
  return disableOneMessage(guildId, channelId).status === 'channel-removed';
}

// --- Messages sauvegardés (slots /save 1..5) ---
// Stockés sous data[guildId].savedMessages[slot] = { content, authorId, ts }.
export function getSavedMessage(guildId, slot) {
  return getGuildConfig(guildId).savedMessages?.[slot] ?? null;
}

export function setSavedMessage(guildId, slot, record) {
  const data = load();
  const g = data[guildId] ?? {};
  g.savedMessages = g.savedMessages ?? {};
  g.savedMessages[slot] = record;
  data[guildId] = g;
  save(data);
  return record;
}

export function deleteSavedMessage(guildId, slot) {
  const data = load();
  const g = data[guildId];
  if (!g?.savedMessages?.[slot]) return false;
  delete g.savedMessages[slot];
  save(data);
  return true;
}

// --- Embeds envoyés avec /embed (proposés par /modifierembed) ---
// sentEmbeds = { messageId: { channelId, title, ts } }, limité aux 100 plus récents.
const MAX_SENT_EMBEDS = 100;

export function getSentEmbeds(guildId) {
  return getGuildConfig(guildId).sentEmbeds ?? {};
}

export function recordSentEmbed(guildId, messageId, record) {
  const entries = Object.entries({ ...getSentEmbeds(guildId), [messageId]: record })
    .sort(([, a], [, b]) => b.ts - a.ts)
    .slice(0, MAX_SENT_EMBEDS);
  setGuildConfig(guildId, { sentEmbeds: Object.fromEntries(entries) });
}

export function removeSentEmbed(guildId, messageId) {
  const { [messageId]: removed, ...rest } = getSentEmbeds(guildId);
  if (!removed) return false;
  setGuildConfig(guildId, { sentEmbeds: rest });
  return true;
}

// --- Message de boost (/configboost) ---
// boostConfig = { channelId, message, mentionType, roleId }
export function getBoostConfig(guildId) {
  return getGuildConfig(guildId).boostConfig ?? null;
}

export function setBoostConfig(guildId, boostConfig) {
  return setGuildConfig(guildId, { boostConfig });
}

// --- Rappel de bump Disboard (/bremind) ---
// bumpReminder = { enabled, roleId, reminderMessage, thanksMessage, channelId,
//                  nextAt, lastBumperId, lastBumpMessageId }
export function getBumpReminder(guildId) {
  return getGuildConfig(guildId).bumpReminder ?? {};
}

export function patchBumpReminder(guildId, patch) {
  return setGuildConfig(guildId, { bumpReminder: { ...getBumpReminder(guildId), ...patch } }).bumpReminder;
}

// Tous les rappels de bump de tous les serveurs (vérification périodique).
export function getAllBumpReminders() {
  return Object.entries(load())
    .filter(([, g]) => g.bumpReminder)
    .map(([guildId, g]) => ({ guildId, cfg: g.bumpReminder }));
}

// --- Partenariats (/embed → Partenariat, /nump) ---
// partner = { channelId, roleId, embed, total, byUser: { userId: nombre },
//             mentions: { userId: [{ channelId, messageId }] } }
export function getPartner(guildId) {
  return getGuildConfig(guildId).partner ?? {};
}

export function patchPartner(guildId, patch) {
  return setGuildConfig(guildId, { partner: { ...getPartner(guildId), ...patch } }).partner;
}

// Un partenariat de plus pour le serveur et pour ce membre.
export function recordPartnership(guildId, userId) {
  const p = getPartner(guildId);
  const byUser = { ...p.byUser, [userId]: (p.byUser?.[userId] ?? 0) + 1 };
  return patchPartner(guildId, { total: (p.total ?? 0) + 1, byUser });
}

// Message du salon partenariat où ce membre a été mentionné (supprimé s'il quitte).
export function addPartnerMention(guildId, userId, ref) {
  const mentions = getPartner(guildId).mentions ?? {};
  patchPartner(guildId, { mentions: { ...mentions, [userId]: [...(mentions[userId] ?? []), ref] } });
}

// Renvoie les messages où ce membre a été mentionné et les oublie.
export function takePartnerMentions(guildId, userId) {
  const mentions = { ...(getPartner(guildId).mentions ?? {}) };
  const refs = mentions[userId] ?? [];
  if (!refs.length) return refs;
  delete mentions[userId];
  patchPartner(guildId, { mentions });
  return refs;
}

// --- Giveaways ---
// Stockés sous data[guildId].giveaways[messageId].
export function createGiveaway(guildId, messageId, gw) {
  const data = load();
  const g = data[guildId] ?? {};
  g.giveaways = g.giveaways ?? {};
  g.giveaways[messageId] = gw;
  data[guildId] = g;
  save(data);
  return gw;
}

export function getGiveaway(guildId, messageId) {
  return getGuildConfig(guildId).giveaways?.[messageId] ?? null;
}

export function updateGiveaway(guildId, messageId, patch) {
  const data = load();
  const gws = data[guildId]?.giveaways;
  if (!gws?.[messageId]) return null;
  gws[messageId] = { ...gws[messageId], ...patch };
  save(data);
  return gws[messageId];
}

export function deleteGiveaway(guildId, messageId) {
  const data = load();
  const gws = data[guildId]?.giveaways;
  if (!gws?.[messageId]) return;
  delete gws[messageId];
  save(data);
}

export function getGuildGiveaways(guildId) {
  return getGuildConfig(guildId).giveaways ?? {};
}

export function addGiveawayParticipant(guildId, messageId, userId) {
  const data = load();
  const gw = data[guildId]?.giveaways?.[messageId];
  if (!gw) return { ok: false };
  gw.participants = gw.participants ?? [];
  if (gw.participants.includes(userId)) return { ok: true, already: true };
  gw.participants.push(userId);
  save(data);
  return { ok: true, already: false };
}

export function removeGiveawayParticipant(guildId, messageId, userId) {
  const data = load();
  const gw = data[guildId]?.giveaways?.[messageId];
  if (!gw) return false;
  gw.participants = (gw.participants ?? []).filter((id) => id !== userId);
  save(data);
  return true;
}

// Incrémente le compteur de messages du membre pour chaque giveaway actif
// (non terminé, avec exigence de messages) du serveur.
export function bumpGiveawayMessages(guildId, userId) {
  const data = load();
  const gws = data[guildId]?.giveaways;
  if (!gws) return;
  let changed = false;
  for (const gw of Object.values(gws)) {
    if (gw.ended || !gw.requiredMessages) continue;
    gw.messageCounts = gw.messageCounts ?? {};
    gw.messageCounts[userId] = (gw.messageCounts[userId] ?? 0) + 1;
    changed = true;
  }
  if (changed) save(data, guildId);
}

// Tous les giveaways de tous les serveurs (reconcile au démarrage).
export function getAllGiveaways() {
  const data = load();
  const out = [];
  for (const [guildId, g] of Object.entries(data)) {
    for (const [messageId, gw] of Object.entries(g.giveaways ?? {})) {
      out.push({ guildId, messageId, gw });
    }
  }
  return out;
}
