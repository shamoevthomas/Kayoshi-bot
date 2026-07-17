import { EmbedBuilder } from 'discord.js';
import { getLinkConfig } from './store.js';
import { sendLog, Colors } from './logger.js';

// Détecte les liens : http(s), www., invitations Discord, ou domaine.tld courant.
const LINK_REGEX =
  /(https?:\/\/[^\s]+)|(www\.[^\s]+)|(discord\.(gg|com\/invite)\/[^\s]+)|(\b[a-z0-9-]+\.(com|net|org|fr|io|gg|xyz|me|tv|co|shop|store|link|app|dev|site|online|be|eu)\b)/i;

export async function handleLinkFilter(message) {
  if (!message.guild || message.author.bot || !message.member) return;
  const config = getLinkConfig(message.guild.id);
  if (!config?.channelIds?.length || !config?.roleIds?.length) return;
  if (!config.channelIds.includes(message.channel.id)) return;

  // Seuls les membres portant un des rôles interdits sont filtrés
  const blocked = message.member.roles.cache.some((r) => config.roleIds.includes(r.id));
  if (!blocked) return;
  if (!LINK_REGEX.test(message.content)) return;

  await message.delete().catch(() => {});
  const warn = await message.channel.send(`❌ ${message.author}, les liens ne sont pas autorisés ici.`).catch(() => null);
  if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);

  await sendLog(
    message.guild,
    new EmbedBuilder()
      .setColor(Colors.delete)
      .setAuthor({ name: '🔗 Lien bloqué' })
      .setDescription(`Message de ${message.author} supprimé dans ${message.channel}`)
      .addFields({ name: 'Contenu', value: message.content.slice(0, 1000) })
      .setTimestamp(),
  );
}
