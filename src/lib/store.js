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

// À appeler UNE FOIS au démarrage (avant client.login).
export async function initStore() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL et SUPABASE_KEY sont requis dans .env');
  supabase = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await supabase.from(TABLE).select('guild_id, data');
  if (error) throw error;
  cache = {};
  for (const row of data) cache[row.guild_id] = row.data ?? {};
  console.log(`🗄️  Store chargé depuis Supabase (${data.length} serveur(s)).`);
}

function load() {
  return cache;
}

function save(data) {
  cache = data;
  for (const gid of Object.keys(cache)) dirty.add(gid);
  scheduleFlush();
}

function scheduleFlush() {
  if (!supabase || flushTimer) return;
  flushTimer = setTimeout(() => flush().catch((e) => console.error(e)), 400);
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
  await flush();
}

export function getGuildConfig(guildId) {
  return load()[guildId] ?? {};
}

export function setGuildConfig(guildId, patch) {
  const data = load();
  data[guildId] = { ...(data[guildId] ?? {}), ...patch };
  save(data);
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
  if (!g.trackingSince) g.trackingSince = Date.now();
  data[guildId] = g;
  save(data);
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
  save(data);
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
  save(data);
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
export function getTicketConfig(guildId) {
  return getGuildConfig(guildId).ticketConfig ?? null;
}

export function setTicketConfig(guildId, ticketConfig) {
  return setGuildConfig(guildId, { ticketConfig });
}

// Réserve et renvoie le prochain numéro de ticket (incrémental).
export function reserveTicketNumber(guildId) {
  const data = load();
  const tc = data[guildId]?.ticketConfig;
  if (!tc) return null;
  tc.counter = (tc.counter ?? 0) + 1;
  save(data);
  return tc.counter;
}

export function saveTicketRecord(guildId, channelId, record) {
  const data = load();
  const tc = data[guildId]?.ticketConfig;
  if (!tc) return;
  tc.tickets = tc.tickets ?? {};
  tc.tickets[channelId] = record;
  save(data);
}

export function getTicketRecord(guildId, channelId) {
  return getGuildConfig(guildId).ticketConfig?.tickets?.[channelId] ?? null;
}

export function updateTicketRecord(guildId, channelId, patch) {
  const data = load();
  const tc = data[guildId]?.ticketConfig;
  if (!tc?.tickets?.[channelId]) return null;
  tc.tickets[channelId] = { ...tc.tickets[channelId], ...patch };
  save(data);
  return tc.tickets[channelId];
}

export function deleteTicketRecord(guildId, channelId) {
  const data = load();
  const tc = data[guildId]?.ticketConfig;
  if (!tc?.tickets?.[channelId]) return;
  delete tc.tickets[channelId];
  save(data);
}

export function countOpenTicketsByUser(guildId, userId) {
  const tickets = getGuildConfig(guildId).ticketConfig?.tickets ?? {};
  return Object.values(tickets).filter((t) => t.userId === userId);
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
  save(data);
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
  save(data);
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

// --- Mode "coiffeur" (répond "feur" quand un message finit par "quoi") ---
export function getCoiffeurEnabled(guildId) {
  return getGuildConfig(guildId).coiffeur === true;
}

export function setCoiffeurEnabled(guildId, enabled) {
  return setGuildConfig(guildId, { coiffeur: Boolean(enabled) });
}

// --- Salons "one-message" (tout nouveau message y est supprimé aussitôt) ---
export function getOneMessageChannels(guildId) {
  return getGuildConfig(guildId).oneMessageChannels ?? [];
}

export function isOneMessageChannel(guildId, channelId) {
  return (getGuildConfig(guildId).oneMessageChannels ?? []).includes(channelId);
}

export function addOneMessageChannel(guildId, channelId) {
  const data = load();
  const g = data[guildId] ?? {};
  g.oneMessageChannels = g.oneMessageChannels ?? [];
  if (g.oneMessageChannels.includes(channelId)) return false;
  g.oneMessageChannels.push(channelId);
  data[guildId] = g;
  save(data);
  return true;
}

export function removeOneMessageChannel(guildId, channelId) {
  const data = load();
  const g = data[guildId];
  if (!g?.oneMessageChannels?.includes(channelId)) return false;
  g.oneMessageChannels = g.oneMessageChannels.filter((id) => id !== channelId);
  save(data);
  return true;
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
  if (changed) save(data);
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
