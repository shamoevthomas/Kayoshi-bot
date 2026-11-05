import { MessageReferenceType, PermissionFlagsBits } from 'discord.js';
import { getPartner, recordPartnership, addPartnerMention, takePartnerMentions } from './store.js';
import { renderEmbedFor } from './greetings.js';
import { withHostedImages } from './rehost.js';
import { botMentionRe } from './quote.js';

// Rôle donné aux membres mentionnés dans le salon partenariat.
const MENTIONED_ROLE_ID = '1410934072603185255';
// Une pub recopiée ne mentionne que des membres : ni @everyone, ni @here, ni rôle.
const COPY_MENTIONS = { parse: ['users'] };

// Salon partenariat (/embed → Partenariat) : chaque message posté compte un
// partenariat pour son auteur, puis l'embed enregistré est envoyé avec la
// mention du rôle. [user], [@]… désignent l'auteur du message.
export async function handlePartnerMessage(message) {
  if (!message.guild || message.author.bot) return;
  const cfg = getPartner(message.guild.id);
  if (!cfg.embed || cfg.channelId !== message.channelId) return;

  await handlePartnerMentions(message);
  await sendPartnerEmbed(message.channel, message.member ?? message.author, cfg).catch((err) =>
    console.error('[partenariat] envoi impossible :', err.message),
  );
}

// +1 partenariat pour `who` (membre ou utilisateur), puis l'embed partenariat envoyé dans le salon
// avec la mention du rôle : [user], [@]… désignent `who`.
async function sendPartnerEmbed(channel, who, cfg) {
  recordPartnership(channel.guild.id, who.id);
  const embed = await renderEmbedFor(channel.guild, who.user ?? who, cfg.embed);
  // L'auteur de l'embed devient celui qui a fait le partenariat (sauf si l'embed n'a pas d'auteur).
  if (embed.author) embed.author = { name: who.displayName, icon_url: who.displayAvatarURL() };
  // Ancien pied de page automatique « Partenariat avec <nom du serveur> » : retiré
  // (un pied de page personnalisé via /embed est gardé).
  if (embed.footer?.text?.startsWith('Partenariat avec')) delete embed.footer;
  embed.timestamp = new Date().toISOString();

  return channel.send(
    await withHostedImages({
      ...(cfg.roleId ? { content: `<@&${cfg.roleId}>` } : {}),
      embeds: [embed],
      allowedMentions: { roles: cfg.roleId ? [cfg.roleId] : [] },
    }),
  );
}

// « @Kayoshi part » en réponse à un message (la pub d'un partenaire, souvent dans un ticket) : son texte
// et ses fichiers sont recopiés dans le salon partenariat, puis l'embed partenariat est envoyé au nom de
// celui qui a écrit la commande ([@] = lui), qui gagne le partenariat.
// Réservé à ceux qui peuvent écrire dans le salon partenariat.
export async function handlePartnerCopyCommand(message) {
  if (!message.guild || message.author.bot || !message.reference?.messageId) return false;
  if (message.reference.type === MessageReferenceType.Forward) return false;
  if (!botMentionRe(message).test(message.content)) return false;
  if (message.content.replace(botMentionRe(message), '').trim().toLowerCase() !== 'part') return false;

  const answer = (content) => message.reply({ content, allowedMentions: { repliedUser: false } }).catch(() => {});
  const cfg = getPartner(message.guild.id);
  const channel = cfg.embed ? message.guild.channels.cache.get(cfg.channelId) : null;
  if (!channel) {
    await answer('❌ Aucun salon partenariat configuré : choisis-le avec `/embed` → 🤝 Partenariat.');
    return true;
  }
  const who = message.member ?? message.author;
  if (!channel.permissionsFor(who)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    await answer(`❌ Seuls ceux qui peuvent écrire dans ${channel} peuvent faire un partenariat.`);
    return true;
  }
  const original = await message.fetchReference().catch(() => null);
  if (!original) {
    await answer('❌ Je n’arrive pas à lire le message auquel tu réponds.');
    return true;
  }
  const files = [...original.attachments.values()].map((a) => ({ attachment: a.url, name: a.name }));
  if (!original.content.trim() && !files.length) {
    await answer('❌ Ce message n’a ni texte ni fichier à recopier.');
    return true;
  }

  try {
    // Texte en messages de 2 000 caractères au plus, les fichiers avec le dernier.
    const chunks = splitText(original.content);
    const copies = [];
    for (const [i, content] of chunks.entries()) {
      const last = i === chunks.length - 1;
      copies.push(await sendCopy(channel, content, last ? files : []));
    }
    for (const copy of copies) await handlePartnerMentions(copy);
    await sendPartnerEmbed(channel, who, cfg);
    await answer(`✅ Partenariat publié : ${copies[0].url}`);
  } catch (err) {
    console.error('[partenariat] copie impossible :', err.message);
    await answer(`❌ Je n’ai pas pu publier dans ${channel} (il me faut **Envoyer des messages**, **Intégrer des liens** et **Joindre des fichiers**).`);
  }
  return true;
}

// Un morceau de la pub recopiée ; si ses fichiers ne passent pas (trop lourds…), le texte part seul.
async function sendCopy(channel, content, files) {
  return channel.send({ content: content || undefined, files, allowedMentions: COPY_MENTIONS }).catch((err) => {
    if (!files.length || !content) throw err;
    console.error('[partenariat] fichiers impossibles à recopier :', err.message);
    return channel.send({ content, allowedMentions: COPY_MENTIONS });
  });
}

// Découpe un texte en morceaux de 2 000 caractères au plus, de préférence à un saut de ligne ou à
// un espace (un texte vide donne un seul morceau vide, pour envoyer les fichiers seuls).
function splitText(text, max = 2000) {
  const chunks = [];
  let rest = text.trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf('\n', max);
    if (cut <= 0) cut = rest.lastIndexOf(' ', max);
    if (cut <= 0) cut = max;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  chunks.push(rest);
  return chunks;
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
