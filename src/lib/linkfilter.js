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

  // Un rôle autorisé (exception) l'emporte : le membre peut poster des liens partout.
  const exempt = message.member.roles.cache.some((r) => config.allowedRoleIds?.includes(r.id));
  if (exempt) return;

  // Seuls les membres portant un des rôles interdits sont filtrés
  const blocked = message.member.roles.cache.some((r) => config.roleIds.includes(r.id));
  if (!blocked) return;

  const urls = message.content.match(URL_GLOBAL) || [];
  if (urls.length === 0) return;
  // Autorisé si tous les liens sont des GIF/plateformes whitelistées ;
  // bloqué dès qu'un lien non autorisé est présent.
  const forbidden = urls.filter((u) => !isAllowedLink(u));
  if (forbidden.length === 0) return;

  await message.delete().catch(() => {});
  const warn = await message.channel.send(`❌ ${message.author}, les liens ne sont pas autorisés ici.`).catch(() => null);
  if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);

  const embed = new EmbedBuilder()
    .setColor(Colors.delete)
    .setAuthor({ name: '🔗 Lien bloqué' })
    .setDescription(`Message de ${message.author} supprimé dans ${message.channel}`)
    .addFields(
      { name: 'Lien(s) détecté(s)', value: forbidden.join('\n').slice(0, 1000) },
      { name: 'Contenu', value: message.content.slice(0, 1000) },
    )
    .setTimestamp();

  // Salon dédié aux liens détectés s'il est configuré, sinon le salon de logs habituel.
  const logChannel = config.logChannelId
    ? message.guild.channels.cache.get(config.logChannelId) ??
      (await message.guild.channels.fetch(config.logChannelId).catch(() => null))
    : null;
  if (logChannel?.isTextBased()) await logChannel.send({ embeds: [embed] }).catch(() => {});
  else await sendLog(message.guild, embed);
}
