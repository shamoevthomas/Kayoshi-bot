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
    .replace(/^https?:\/\/(www\.)?(youtube\.com|tiktok\.com)\//i, '')
    .replace(/^@/, '')
    .split(/[/?]/)[0]
    .toLowerCase();
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
  const platformName = platform === 'youtube' ? 'YouTubeur' : 'TikTokeur';

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
      content: ok ? `✅ **${key}** n'est plus suivi.` : `❌ Aucun ${platformName} \`${key}\` dans la liste. (\`/${platform === 'youtube' ? 'youtubeur' : 'tiktokeur'} liste\`)`,
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

  await interaction.deferReply({ ephemeral: true });

  const resolved = platform === 'youtube' ? await resolveYouTube(nom) : await resolveTikTok(nom);
  if (!resolved) {
    return interaction.editReply({
      content:
        platform === 'youtube'
          ? `❌ Chaîne YouTube introuvable pour \`${nom}\`. Essaie le **@handle**, l'URL de la chaîne, ou l'ID \`UC...\`.`
          : `❌ Compte TikTok invalide pour \`${nom}\`. Donne le **@pseudo** (ex: \`@charlidamelio\`).`,
    });
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
    lastVideoId: null, // baseline posée à la 1re veille (pas de spam des anciennes vidéos)
  });

  const mLabel = mentionType === 'everyone' ? '@everyone' : mentionType === 'here' ? '@here' : mentionType === 'role' ? `<@&${roleId}>` : 'aucune';
  return interaction.editReply({
    content:
      `✅ ${existing ? 'Mis à jour' : 'Suivi ajouté'} : **${resolved.title}**\n` +
      `• Vidéos envoyées dans ${channel}\n` +
      `• Mention : ${mLabel}\n` +
      `Les **nouvelles** vidéos publiées à partir de maintenant y seront postées (vérification toutes les 10 min).`,
  });
}
