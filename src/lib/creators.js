import {
  PermissionFlagsBits,
} from 'discord.js';
import { getCreators, addCreator, removeCreator, updateCreator, getAllCreators } from './store.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36';
// Instance RSSHub pour TikTok (configurable ; par défaut l'instance publique).
const RSSHUB = (process.env.RSSHUB_BASE || 'https://rsshub.app').replace(/\/$/, '');

function decodeEntities(s = '') {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .trim();
}

async function getText(url, headers = {}) {
  try {
    const r = await fetch(url, {
      headers: { 'user-agent': UA, 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8', ...headers },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    return await r.text();
  } catch {
    return null;
  }
}

// ---------- YouTube ----------
async function ytTitleFor(channelId) {
  const xml = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  const t = xml?.match(/<title>(.*?)<\/title>/);
  return { channelId, title: t ? decodeEntities(t[1]) : channelId };
}

// Résout un nom/handle/URL YouTube en { channelId, title } ou null.
export async function resolveYouTube(input) {
  const s = input.trim();
  const uc = s.match(/(UC[0-9A-Za-z_-]{22})/);
  if (uc) return ytTitleFor(uc[1]);

  const urls = [];
  if (/^https?:\/\//i.test(s)) urls.push(s);
  else {
    const h = s.replace(/^@/, '');
    urls.push(`https://www.youtube.com/@${h}`, `https://www.youtube.com/c/${h}`, `https://www.youtube.com/user/${h}`);
  }
  for (const url of urls) {
    const html = await getText(url);
    if (!html) continue;
    const m =
      html.match(/"channelId":"(UC[0-9A-Za-z_-]{22})"/) ||
      html.match(/"externalId":"(UC[0-9A-Za-z_-]{22})"/) ||
      html.match(/channel\/(UC[0-9A-Za-z_-]{22})/);
    if (m) {
      const t = html.match(/<meta property="og:title" content="([^"]+)"/);
      return { channelId: m[1], title: t ? decodeEntities(t[1]) : s.replace(/^@/, '') };
    }
  }
  return null;
}

// Vidéos récentes (plus récente en premier) ou null si la requête a échoué.
async function fetchYouTubeVideos(channelId) {
  const xml = await getText(`https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`);
  if (!xml) return null;
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  return entries
    .map(([, b]) => {
      const id = (b.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
      const title = decodeEntities((b.match(/<title>(.*?)<\/title>/) || [])[1] || '');
      return id ? { id, title, url: `https://www.youtube.com/watch?v=${id}` } : null;
    })
    .filter(Boolean);
}

// ---------- TikTok (via RSSHub) ----------
export async function resolveTikTok(input) {
  const username = input
    .trim()
    .replace(/^https?:\/\/(www\.)?tiktok\.com\//i, '')
    .replace(/^@/, '')
    .split(/[/?]/)[0]
    .toLowerCase();
  if (!username) return null;
  return { username, title: `@${username}` };
}

async function fetchTikTokVideos(username) {
  const xml = await getText(`${RSSHUB}/tiktok/user/@${username}`);
  if (!xml) return null;
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  return items
    .map(([, b]) => {
      const link = ((b.match(/<link>(.*?)<\/link>/) || [])[1] || (b.match(/<guid[^>]*>(.*?)<\/guid>/) || [])[1] || '').trim();
      const title = decodeEntities((b.match(/<title>(.*?)<\/title>/) || [])[1] || 'Vidéo TikTok');
      const idm = link.match(/\/video\/(\d+)/);
      const id = idm ? idm[1] : link;
      return id ? { id, title, url: link } : null;
    })
    .filter(Boolean);
}

// ---------- Twitch (API Helix) ----------
export function twitchConfigured() {
  return Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
}

let twitchToken = { value: null, exp: 0 };
async function getTwitchToken() {
  if (!twitchConfigured()) return null;
  if (twitchToken.value && Date.now() < twitchToken.exp) return twitchToken.value;
  try {
    const r = await fetch(
      `https://id.twitch.tv/oauth2/token?client_id=${process.env.TWITCH_CLIENT_ID}&client_secret=${process.env.TWITCH_CLIENT_SECRET}&grant_type=client_credentials`,
      { method: 'POST', signal: AbortSignal.timeout(10_000) },
    );
    if (!r.ok) return null;
    const j = await r.json();
    if (!j.access_token) return null;
    twitchToken = { value: j.access_token, exp: Date.now() + (j.expires_in - 60) * 1000 };
    return twitchToken.value;
  } catch {
    return null;
  }
}

async function twitchApi(path) {
  const token = await getTwitchToken();
  if (!token) return null;
  try {
    const r = await fetch(`https://api.twitch.tv/helix/${path}`, {
      headers: { 'Client-ID': process.env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

// Résout un pseudo/URL Twitch en { username(login), title(display) } ; null si introuvable.
export async function resolveTwitch(input) {
  const login = input
    .trim()
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '')
    .replace(/^@/, '')
    .split(/[/?]/)[0]
    .toLowerCase();
  if (!login) return null;
  const data = await twitchApi(`users?login=${encodeURIComponent(login)}`);
  const u = data?.data?.[0];
  if (!u) return null;
  return { username: u.login, title: u.display_name };
}

async function postLive(channel, sub, stream) {
  const { text, allowed } = mentionOf(sub);
  const url = `https://twitch.tv/${sub.channelId}`;
  const game = stream.game_name ? ` · 🎮 ${stream.game_name}` : '';
  const content =
    `${text ? `${text} ` : ''}🔴 **Twitch** — **${sub.title}** est en **LIVE** !\n` +
    `${stream.title ? `**${stream.title}**${game}\n` : ''}${url}`;
  await channel.send({ content: content.slice(0, 2000), allowedMentions: allowed });
}

async function pollTwitch(client, guildId, key, sub) {
  const data = await twitchApi(`streams?user_login=${encodeURIComponent(sub.channelId)}`);
  if (!data) return; // identifiants manquants ou erreur → on ne touche à rien
  const stream = data.data?.[0];
  const liveId = stream?.id ?? null;
  if (!liveId) return; // hors ligne
  if (sub.lastStreamId === liveId) return; // ce live a déjà été annoncé

  const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
  const channel = guild
    ? guild.channels.cache.get(sub.postChannelId) ?? (await guild.channels.fetch(sub.postChannelId).catch(() => null))
    : null;
  if (channel?.isTextBased()) await postLive(channel, sub, stream).catch(() => {});
  updateCreator(guildId, 'twitch', key, { lastStreamId: liveId });
}

// ---------- Publication ----------
function mentionOf(sub) {
  if (sub.mentionType === 'everyone') return { text: '@everyone', allowed: { parse: ['everyone'] } };
  if (sub.mentionType === 'here') return { text: '@here', allowed: { parse: ['everyone'] } };
  if (sub.mentionType === 'role' && sub.roleId) return { text: `<@&${sub.roleId}>`, allowed: { roles: [sub.roleId] } };
  return { text: '', allowed: { parse: [] } };
}

async function postVideo(channel, platform, sub, v) {
  const { text, allowed } = mentionOf(sub);
  const label = platform === 'youtube' ? '📺 **YouTube**' : '🎵 **TikTok**';
  const content =
    `${text ? `${text} ` : ''}${label} — **${sub.title}** vient de publier une vidéo !\n${v.url}`;
  await channel.send({ content: content.slice(0, 2000), allowedMentions: allowed });
}

async function pollOne(client, guildId, platform, key, sub) {
  if (platform === 'twitch') return pollTwitch(client, guildId, key, sub);

  const videos = platform === 'youtube' ? await fetchYouTubeVideos(sub.channelId) : await fetchTikTokVideos(sub.channelId);
  if (!videos || !videos.length) return; // échec réseau ou aucune vidéo → on ne touche à rien

  // Première veille : on mémorise la dernière vidéo sans rien poster (pas de spam).
  if (sub.lastVideoId == null) {
    updateCreator(guildId, platform, key, { lastVideoId: videos[0].id });
    return;
  }

  const fresh = [];
  for (const v of videos) {
    if (v.id === sub.lastVideoId) break;
    fresh.push(v);
  }
  if (!fresh.length) return;
  fresh.reverse(); // de la plus ancienne à la plus récente

  const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
  const channel = guild
    ? guild.channels.cache.get(sub.postChannelId) ?? (await guild.channels.fetch(sub.postChannelId).catch(() => null))
    : null;
  if (channel?.isTextBased()) {
    for (const v of fresh) await postVideo(channel, platform, sub, v).catch(() => {});
  }
  updateCreator(guildId, platform, key, { lastVideoId: videos[0].id });
}

// Veille de tous les créateurs suivis, tous serveurs confondus.
export async function pollAllCreators(client) {
  for (const { guildId, platform, key, sub } of getAllCreators()) {
    try {
      await pollOne(client, guildId, platform, key, sub);
    } catch (err) {
      console.error('[creators] veille échouée :', err);
    }
  }
}

// ---------- Logique des commandes /youtubeur et /tiktokeur ----------
function normalizeKey(platform, input) {
  return input
    .trim()
    .replace(/^https?:\/\/(www\.)?(youtube\.com|tiktok\.com|twitch\.tv)\//i, '')
    .replace(/^@/, '')
    .split(/[/?]/)[0]
    .toLowerCase();
}

const PLATFORM_NAMES = { youtube: 'YouTubeur', tiktok: 'TikTokeur', twitch: 'streameur Twitch' };
const COMMAND_NAMES = { youtube: 'youtubeur', tiktok: 'tiktokeur', twitch: 'twitch' };

async function resolveCreator(platform, input) {
  if (platform === 'youtube') return resolveYouTube(input);
  if (platform === 'tiktok') return resolveTikTok(input);
  return resolveTwitch(input);
}

function mentionFromOptions(interaction) {
  if (interaction.options.getBoolean('everyone')) return { mentionType: 'everyone', roleId: null };
  if (interaction.options.getBoolean('here')) return { mentionType: 'here', roleId: null };
  const role = interaction.options.getRole('role');
  if (role) return { mentionType: 'role', roleId: role.id };
  return { mentionType: 'none', roleId: null };
}

export async function runCreatorCommand(interaction, platform) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guild.id;
  const platformName = PLATFORM_NAMES[platform];
  const commandName = COMMAND_NAMES[platform];

  if (sub === 'liste') {
    const list = getCreators(guildId, platform);
    const keys = Object.keys(list);
    if (!keys.length) return interaction.reply({ content: `Aucun ${platformName} suivi.`, ephemeral: true });
    const lines = keys.map((k) => {
      const s = list[k];
      const m =
        s.mentionType === 'everyone' ? '@everyone' : s.mentionType === 'here' ? '@here' : s.mentionType === 'role' ? `<@&${s.roleId}>` : 'aucune';
      return `• **${s.title}** (\`${s.username}\`) → <#${s.postChannelId}> · mention : ${m}`;
    });
    return interaction.reply({ content: `📥 **${platformName}s suivis :**\n${lines.join('\n')}`, ephemeral: true });
  }

  if (sub === 'retirer') {
    const key = normalizeKey(platform, interaction.options.getString('nom'));
    const ok = removeCreator(guildId, platform, key);
    return interaction.reply({
      content: ok ? `✅ **${key}** n'est plus suivi.` : `❌ Aucun ${platformName} \`${key}\` dans la liste. (\`/${commandName} liste\`)`,
      ephemeral: true,
    });
  }

  // ajouter
  const nom = interaction.options.getString('nom');
  const channel = interaction.options.getChannel('salon');
  const me = interaction.guild.members.me;
  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.SendMessages)) {
    return interaction.reply({ content: `❌ Je ne peux pas envoyer de message dans ${channel}.`, ephemeral: true });
  }

  // Twitch a besoin d'identifiants API.
  if (platform === 'twitch' && !twitchConfigured()) {
    return interaction.reply({
      content:
        '❌ Le suivi Twitch nécessite une clé API. Ajoute les variables d’environnement **`TWITCH_CLIENT_ID`** et **`TWITCH_CLIENT_SECRET`** (créées sur https://dev.twitch.tv/console) sur l’hébergeur, puis redémarre le bot.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });

  const resolved = await resolveCreator(platform, nom);
  if (!resolved) {
    const hint = {
      youtube: `❌ Chaîne YouTube introuvable pour \`${nom}\`. Essaie le **@handle**, l'URL de la chaîne, ou l'ID \`UC...\`.`,
      tiktok: `❌ Compte TikTok invalide pour \`${nom}\`. Donne le **@pseudo** (ex: \`@charlidamelio\`).`,
      twitch: `❌ Chaîne Twitch introuvable pour \`${nom}\`. Donne le **pseudo** exact (ex: \`ninja\`).`,
    };
    return interaction.editReply({ content: hint[platform] });
  }

  const { mentionType, roleId } = mentionFromOptions(interaction);
  const key = normalizeKey(platform, nom);
  const existing = getCreators(guildId, platform)[key];

  addCreator(guildId, platform, key, {
    username: key,
    channelId: platform === 'youtube' ? resolved.channelId : resolved.username,
    title: resolved.title,
    postChannelId: channel.id,
    mentionType,
    roleId,
    lastVideoId: null, // YouTube/TikTok : baseline posée à la 1re veille (pas de spam)
    lastStreamId: null, // Twitch : dernier live annoncé
  });

  const mLabel = mentionType === 'everyone' ? '@everyone' : mentionType === 'here' ? '@here' : mentionType === 'role' ? `<@&${roleId}>` : 'aucune';
  const what = platform === 'twitch' ? 'Un message sera posté **quand la chaîne passe en live**' : 'Les **nouvelles vidéos** publiées à partir de maintenant y seront postées';
  return interaction.editReply({
    content:
      `✅ ${existing ? 'Mis à jour' : 'Suivi ajouté'} : **${resolved.title}**\n` +
      `• Salon : ${channel}\n` +
      `• Mention : ${mLabel}\n` +
      `${what} (vérification toutes les 10 min).`,
  });
}
