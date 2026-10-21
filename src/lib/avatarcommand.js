import { EmbedBuilder } from 'discord.js';

// « kayo pp [@membre] » : envoie la photo de profil du membre mentionné (ou la sienne).
const COMMAND = /^kayo\s+pp\b\s*(.*)$/i;

export async function handleAvatarCommand(message) {
  if (!message.guild || message.author.bot) return false;
  const match = message.content.trim().match(COMMAND);
  if (!match) return false;

  // Membre mentionné, ou ID écrit après la commande, sinon l'auteur.
  const arg = match[1].trim();
  const id = message.mentions.users.first()?.id ?? arg.match(/\d{17,20}/)?.[0];
  const user = id ? await message.client.users.fetch(id).catch(() => null) : message.author;
  if (!user) {
    await message.reply({ content: '❌ Membre introuvable.', allowedMentions: { repliedUser: false } }).catch(() => {});
    return true;
  }

  // Avatar du serveur si le membre en a un, sinon son avatar global, en grand.
  const member = message.guild.members.cache.get(user.id) ?? (await message.guild.members.fetch(user.id).catch(() => null));
  const url = (member ?? user).displayAvatarURL({ size: 1024, extension: 'png', forceStatic: false });
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: `Photo de profil de ${member?.displayName ?? user.username}` })
    .setImage(url)
    .setFooter({ text: `Demandé par ${message.member?.displayName ?? message.author.username}` });

  await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => {});
  return true;
}
