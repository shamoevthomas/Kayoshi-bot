import { PermissionFlagsBits } from 'discord.js';

// Lien de GIF (bouton GIF Discord = lien Tenor, ou Giphy, ou fichier .gif).
const GIF_RE = /tenor\.(com|co)|giphy\.com|\.gif(\?|#|$)/i;

// Si un membre poste un GIF mais n'a PAS la permission « Intégrer les liens »
// (donc le GIF ne s'affiche pas), on lui explique comment débloquer les images.
export async function handleGifPermHint(message) {
  if (!message.guild || message.author.bot || !message.member) return;

  const hasGif = GIF_RE.test(message.content) || message.attachments.some((a) => /\.gif$/i.test(a.name ?? ''));
  if (!hasGif) return;

  const perms = message.channel.permissionsFor(message.member);
  if (perms?.has(PermissionFlagsBits.EmbedLinks)) return; // il peut déjà intégrer → rien à faire

  const hint = await message.channel
    .send({
      content: `${message.author} pour avoir perm image il faut avoir \`/ximi\` en statut ou avoir le tag`,
      allowedMentions: { users: [message.author.id] },
    })
    .catch(() => null);
  if (hint) setTimeout(() => hint.delete().catch(() => {}), 15_000);
}
