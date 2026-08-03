import { createClient } from '@supabase/supabase-js';

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

// Crédite une arrivée à un parrain et retient qui a invité le nouveau membre.
export function recordInviteJoin(guildId, inviterId, joinerId) {
  const data = load();
  const g = data[guildId] ?? {};
  const s = statsFor(g, inviterId);
  s.real += 1;
  g.invitedBy = g.invitedBy ?? {};
  g.invitedBy[joinerId] = inviterId;
  data[guildId] = g;
  save(data);
  return s.real + s.bonus;
}

// Décompte un départ : si on connaît le parrain du partant, real-1 et left+1.
// Renvoie { inviterId, total } ou null si le parrain est inconnu.
export function recordInviteLeave(guildId, leaverId) {
  const data = load();
  const g = data[guildId];
  const inviterId = g?.invitedBy?.[leaverId];
  if (!inviterId) return null;
  delete g.invitedBy[leaverId];
  const s = statsFor(g, inviterId);
  if (s.real > 0) s.real -= 1;
  s.left += 1;
  data[guildId] = g;
  save(data);
  return { inviterId, total: s.real + s.bonus };
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
