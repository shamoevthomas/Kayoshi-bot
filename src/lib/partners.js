import { getPartner, recordPartnership } from './store.js';
import { renderEmbedFor } from './greetings.js';

// Salon partenariat (/embed → Partenariat) : chaque message posté compte un
// partenariat pour son auteur, puis l'embed enregistré est envoyé avec la
// mention du rôle. [user], [@]… désignent l'auteur du message.
export async function handlePartnerMessage(message) {
  if (!message.guild || message.author.bot) return;
  const cfg = getPartner(message.guild.id);
  if (!cfg.embed || cfg.channelId !== message.channelId) return;

  recordPartnership(message.guild.id, message.author.id);
  const embed = await renderEmbedFor(message.guild, message.author, cfg.embed);
  // L'auteur de l'embed devient celui qui a fait le partenariat (sauf si l'embed n'a pas d'auteur).
  const who = message.member ?? message.author;
  if (embed.author) embed.author = { name: who.displayName, icon_url: who.displayAvatarURL() };
  embed.timestamp = new Date().toISOString();

  await message.channel
    .send({
      ...(cfg.roleId ? { content: `<@&${cfg.roleId}>` } : {}),
      embeds: [embed],
      allowedMentions: { roles: cfg.roleId ? [cfg.roleId] : [] },
    })
    .catch((err) => console.error('[partenariat] envoi impossible :', err.message));
}
