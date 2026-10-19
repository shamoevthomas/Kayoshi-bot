import { EmbedBuilder } from 'discord.js';
import { getLinkConfig, getJailConfig, getJailRecord } from './store.js';
import { sendLog, Colors } from './logger.js';
import { jailMember } from './jail.js';

// Extrait tous les liens d'un message (http, www, invitations, domaine.tld). Les sous-domaines
// sont gardés (music.youtube.com, et non youtube.com) pour juger le lien sur son vrai domaine.
const URL_GLOBAL =
  /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(discord\.(gg|com\/invite)\/[^\s]+)|(\b(?:[a-z0-9-]+\.)+(com|net|org|fr|io|gg|xyz|me|tv|co|shop|store|link|app|dev|site|online|be|eu)\b[^\s]*)/gi;

// Un lien GIF est autorisé (Tenor, Giphy, Kiplys, ou fichier .gif — inclut le bouton GIF de Discord).
function isGifLink(url) {
  return /tenor\.(com|co)|giphy\.com|k(i|l)ip(l)?y\.[a-z]+|\.gif(\?|#|$)/i.test(url);
}

// Plateformes autorisées (le domaine ou un de ses sous-domaines) : la musique (SoundCloud,
// Spotify, Deezer, YouTube Music). YouTube, TikTok, Instagram et Snapchat sont filtrés
// comme les autres liens — seul music.youtube.com passe.
const ALLOWED_PLATFORMS = [
  'soundcloud.com',
  'spotify.com',
  'spotify.link', // liens de partage de l'appli mobile
  'deezer.com',
  'deezer.page.link', // anciens liens de partage Deezer
  'music.youtube.com',
];

function isAllowedPlatform(url) {
  const host = url.match(/^(?:https?:\/\/)?([^/?#:\s]+)/i)?.[1].toLowerCase();
  return !!host && ALLOWED_PLATFORMS.some((d) => host === d || host.endsWith(`.${d}`));
}

// Cadeau Discord (Nitro) : discord.gift/<code> ou discord.com/gifts/<code>.
// Ancré sur le domaine pour ne pas laisser passer les faux domaines de phishing.
function isDiscordGift(url) {
  return /^(https?:\/\/)?(www\.)?(discord\.gift\/|((ptb|canary)\.)?discord(app)?\.com\/gifts\/)/i.test(url);
}

// Fichier hébergé par Discord (cdn.discordapp.com : images, vidéos, pièces jointes).
// Ancré sur le domaine pour ne pas laisser passer cdn.discordapp.com.faux-site.xyz.
function isDiscordCdn(url) {
  return /^(https?:\/\/)?cdn\.discordapp\.com\//i.test(url);
}

// Lien vers un salon / message de ce serveur : Discord l'affiche comme une
// mention de salon, ce n'est pas un vrai lien → jamais filtré.
function isOwnChannelLink(url, guildId) {
  return new RegExp(`^(https?://)?((ptb|canary)\\.)?discord(app)?\\.com/channels/${guildId}/`, 'i').test(url);
}

// Un lien est autorisé s'il s'agit d'un GIF, d'une plateforme whitelistée, d'un cadeau Discord
// ou d'un fichier du CDN de Discord.
function isAllowedLink(url) {
  return isGifLink(url) || isAllowedPlatform(url) || isDiscordGift(url) || isDiscordCdn(url);
}

// Invitation Discord (discord.gg/code, discord.com/invite/code) : renvoie son code.
const INVITE = /(?:discord\.gg|discord(?:app)?\.com\/invite)\/([\w-]+)/i;

// Invitation vers un autre serveur ? Les invitations connues du serveur et son URL
// personnalisée passent sans appel à Discord. Une invitation qu'on ne peut pas
// rattacher à ce serveur (expirée, erreur) est considérée comme étrangère.
async function isForeignInvite(url, guild) {
  const code = url.match(INVITE)?.[1];
  if (!code) return false;
  if (code.toLowerCase() === guild.vanityURLCode?.toLowerCase() || guild.invites.cache.has(code)) return false;
  const invite = await guild.client.fetchInvite(code).catch(() => null);
  return invite?.guild?.id !== guild.id;
}

// Messages avec un lien interdit, par membre : le 2ᵉ dans la même minute → jail
// (rôles de /jailconfig). `${guildId}:${userId}` → horodatages.
const STRIKE_WINDOW = 60_000;
const linkStrikes = new Map();

async function jailRepeatOffender(message) {
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  const strikes = (linkStrikes.get(key) ?? []).filter((t) => now - t < STRIKE_WINDOW);
  strikes.push(now);
  linkStrikes.set(key, strikes);
  if (strikes.length < 2) return false;

  if (!getJailConfig(message.guild.id) || getJailRecord(message.guild.id, message.author.id)) return false;
  if (message.author.id === message.guild.ownerId) return false;
  const res = await jailMember(message.member, {
    by: message.client.user,
    reason: 'Anti-liens : 2 liens interdits envoyés en moins d’une minute',
  });
  if (res.error) {
    console.error('[linkfilter] jail impossible :', res.error);
    return false;
  }
  linkStrikes.delete(key);
  return true;
}

export async function handleLinkFilter(message) {
  if (!message.guild || message.author.bot || !message.member) return;
  const config = getLinkConfig(message.guild.id);
  if (!config?.roleIds?.length) return;

  // Les liens sont autorisés dans ces salons (whitelist) : on ne filtre pas.
  if (config.allowedChannelIds?.includes(message.channel.id)) return;

  // Catégorie « Partenariat » (tickets partenariat) : liens autorisés.
  const parentName = message.channel.parent?.name?.toLowerCase() ?? '';
  if (parentName.includes('partenariat')) return;

  const urls = (message.content.match(URL_GLOBAL) || []).filter((u) => !isOwnChannelLink(u, message.guild.id));
  if (urls.length === 0) return;

  // Un rôle autorisé (exception) l'emporte : tous les liens passent, partout,
  // sauf les invitations vers un autre serveur.
  if (message.member.roles.cache.some((r) => config.allowedRoleIds?.includes(r.id))) {
    const invites = [];
    for (const url of urls) if (await isForeignInvite(url, message.guild)) invites.push(url);
    if (!invites.length) return;
    await removeAndWarn(message, 'les invitations vers d’autres serveurs ne sont pas autorisées ici.');
    return logLinks(message, config, invites, []);
  }

  // Seuls les membres portant un des rôles interdits sont filtrés
  const blocked = message.member.roles.cache.some((r) => config.roleIds.includes(r.id));
  if (!blocked) return;

  // Interdits vs autorisés. Les GIF restent autorisés mais ne sont PAS loggés.
  const forbidden = urls.filter((u) => !isAllowedLink(u));
  const allowed = urls.filter((u) => isAllowedLink(u) && !isGifLink(u));

  // Le message est supprimé dès qu'un lien interdit est présent ; à la 2ᵉ fois dans la minute, jail.
  if (forbidden.length) await removeAndWarn(message, 'les liens ne sont pas autorisés ici.');

  // Rien à enregistrer : ni lien interdit, ni lien autorisé loggable (hors GIF)
  // dans un salon dédié.
  if (!forbidden.length && !(config.logChannelId && allowed.length)) return;
  await logLinks(message, config, forbidden, allowed);
}

// Supprime le message et prévient le membre ; au 2ᵉ lien interdit dans la minute, jail.
async function removeAndWarn(message, reason) {
  await message.delete().catch(() => {});
  const jailed = await jailRepeatOffender(message);
  const warn = await message.channel
    .send(jailed ? `⛓️ ${message.author} a été jail : liens envoyés à répétition.` : `❌ ${message.author}, ${reason}`)
    .catch(() => null);
  if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);
}

async function logLinks(message, config, forbidden, allowed) {
  const embed = new EmbedBuilder()
    .setColor(forbidden.length ? Colors.delete : Colors.role)
    .setAuthor({ name: forbidden.length ? '🔗 Lien bloqué' : '🔗 Lien autorisé' })
    .setDescription(
      `Message de ${message.author} dans ${message.channel}${forbidden.length ? ' — **supprimé**' : ''}`,
    )
    .setTimestamp();
  if (forbidden.length) embed.addFields({ name: '⛔ Bloqué(s)', value: forbidden.join('\n').slice(0, 1000) });
  if (allowed.length) embed.addFields({ name: '✅ Autorisé(s)', value: allowed.join('\n').slice(0, 1000) });
  embed.addFields({ name: 'Contenu', value: message.content.slice(0, 1000) });

  // Salon dédié aux liens détectés s'il est configuré ; sinon, pour un lien
  // bloqué uniquement, on retombe sur le salon de logs habituel.
  const logChannel = config.logChannelId
    ? message.guild.channels.cache.get(config.logChannelId) ??
      (await message.guild.channels.fetch(config.logChannelId).catch(() => null))
    : null;
  if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] }).catch(() => {});
  else if (forbidden.length) await sendLog(message.guild, embed);
}
