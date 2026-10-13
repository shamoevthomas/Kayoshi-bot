import { PermissionFlagsBits } from 'discord.js';
import { getGifHint } from './store.js';

// Lien de GIF (bouton GIF Discord = lien Tenor ou Klipy, ou Giphy, ou fichier .gif).
const GIF_RE = /tenor\.(com|co)|giphy\.com|kl?ipl?y\.[a-z]+|\.gif(\?|#|$)/i;

// Si un membre poste un GIF mais n'a PAS la permission « Intégrer les liens »
// (donc le GIF ne s'affiche pas), on lui envoie le message configuré avec /messimage.
export async function handleGifPermHint(message) {
  if (!message.guild || message.author.bot || !message.member) return;

  const config = getGifHint(message.guild.id);
  if (!config?.message) return;
  if (config.ignoredRoleIds?.some((id) => message.member.roles.cache.has(id))) return;

  const hasGif = GIF_RE.test(message.content) || message.attachments.some((a) => /\.gif$/i.test(a.name ?? ''));
  if (!hasGif) return;

  const perms = message.channel.permissionsFor(message.member);
  if (perms?.has(PermissionFlagsBits.EmbedLinks)) return; // il peut déjà intégrer → rien à faire

  const hint = await message.channel
    .send({
      content: `${message.author} ${config.message}`,
      allowedMentions: { users: [message.author.id] },
    })
    .catch(() => null);
  if (hint) setTimeout(() => hint.delete().catch(() => {}), 15_000);
}
