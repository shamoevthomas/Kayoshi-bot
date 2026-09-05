import { EmbedBuilder } from 'discord.js';
import { getLinkConfig } from './store.js';
import { sendLog, Colors } from './logger.js';

// Extrait tous les liens d'un message (http, www, invitations, domaine.tld).
const URL_GLOBAL =
  /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(discord\.(gg|com\/invite)\/[^\s]+)|(\b[a-z0-9-]+\.(com|net|org|fr|io|gg|xyz|me|tv|co|shop|store|link|app|dev|site|online|be|eu)\b[^\s]*)/gi;

// Un lien GIF est autorisé (Tenor, Giphy, Kiplys, ou fichier .gif — inclut le bouton GIF de Discord).
function isGifLink(url) {
  return /tenor\.(com|co)|giphy\.com|k(i|l)ip(l)?y\.[a-z]+|\.gif(\?|#|$)/i.test(url);
}

// Plateformes autorisées : YouTube, TikTok, Instagram, Snapchat (toutes variantes).
function isAllowedPlatform(url) {
  return /(youtube\.com|youtu\.be)|(tiktok\.com)|(instagram\.com|instagr\.am)|(snapchat\.com)/i.test(url);
}

// Un lien est autorisé s'il s'agit d'un GIF ou d'une plateforme whitelistée.
function isAllowedLink(url) {
  return isGifLink(url) || isAllowedPlatform(url);
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

  // Un rôle autorisé (exception) l'emporte : le membre peut poster des liens partout.
  const exempt = message.member.roles.cache.some((r) => config.allowedRoleIds?.includes(r.id));
  if (exempt) return;

  // Seuls les membres portant un des rôles interdits sont filtrés
  const blocked = message.member.roles.cache.some((r) => config.roleIds.includes(r.id));
  if (!blocked) return;

  const urls = message.content.match(URL_GLOBAL) || [];
  if (urls.length === 0) return;
  // Interdits vs autorisés. Les GIF restent autorisés mais ne sont PAS loggés.
  const forbidden = urls.filter((u) => !isAllowedLink(u));
  const allowed = urls.filter((u) => isAllowedLink(u) && !isGifLink(u));

  // Le message est supprimé dès qu'un lien interdit est présent.
  if (forbidden.length) {
    await message.delete().catch(() => {});
    const warn = await message.channel.send(`❌ ${message.author}, les liens ne sont pas autorisés ici.`).catch(() => null);
    if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);
  }

  // Rien à enregistrer : ni lien interdit, ni lien autorisé loggable (hors GIF)
  // dans un salon dédié.
  if (!forbidden.length && !(config.logChannelId && allowed.length)) return;

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
