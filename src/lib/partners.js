import { getPartner, recordPartnership, addPartnerMention, takePartnerMentions } from './store.js';
import { renderEmbedFor } from './greetings.js';

// Rôle donné aux membres mentionnés dans le salon partenariat.
const MENTIONED_ROLE_ID = '1410934072603185255';

// Salon partenariat (/embed → Partenariat) : chaque message posté compte un
// partenariat pour son auteur, puis l'embed enregistré est envoyé avec la
// mention du rôle. [user], [@]… désignent l'auteur du message.
export async function handlePartnerMessage(message) {
  if (!message.guild || message.author.bot) return;
  const cfg = getPartner(message.guild.id);
  if (!cfg.embed || cfg.channelId !== message.channelId) return;

  recordPartnership(message.guild.id, message.author.id);
  await handlePartnerMentions(message);
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

// Membres mentionnés dans le message : ils reçoivent le rôle, et le message est
// mémorisé pour être supprimé s'ils quittent le serveur.
async function handlePartnerMentions(message) {
  for (const user of message.mentions.parsedUsers.values()) {
    if (user.bot) continue;
    const member = await message.guild.members.fetch(user.id).catch(() => null);
    if (!member) continue;
    addPartnerMention(message.guild.id, user.id, { channelId: message.channelId, messageId: message.id });
    if (message.guild.roles.cache.has(MENTIONED_ROLE_ID)) {
      await member.roles
        .add(MENTIONED_ROLE_ID, 'Mentionné dans le salon partenariat')
        .catch((err) => console.error('[partenariat] rôle impossible à donner :', err.message));
    }
  }
}

// Départ d'un membre : supprime les messages du salon partenariat où il était mentionné.
export async function deletePartnerMentionsOnLeave(member) {
  for (const { channelId, messageId } of takePartnerMentions(member.guild.id, member.id)) {
    const channel = member.guild.channels.cache.get(channelId);
    await channel?.messages.delete(messageId).catch(() => {});
  }
}
