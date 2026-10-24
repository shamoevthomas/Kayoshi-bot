import { EmbedBuilder } from 'discord.js';

// « kayo pp [@membre] » (ou « kayo pfp ») : envoie la photo de profil du membre mentionné (ou la sienne).
// « kayo banner [@membre] » : pareil avec la bannière.
// « kayo pp server » / « kayo banner server » : icône / bannière du serveur.
const COMMAND = /^kayo\s+(pp|pfp|banner)\b\s*(.*)$/i;

export async function handleAvatarCommand(message) {
  if (!message.guild || message.author.bot) return false;
  const match = message.content.trim().match(COMMAND);
  if (!match) return false;
  const banner = match[1].toLowerCase() === 'banner';
  const arg = match[2].trim();
  if (/^serv(er|eur)$/i.test(arg)) return sendGuildImage(message, banner);

  // Membre mentionné, ou ID écrit après la commande, sinon l'auteur.
  // La bannière n'est connue qu'en rechargeant le membre puis l'utilisateur depuis Discord (force).
  const id = message.mentions.users.first()?.id ?? arg.match(/\d{17,20}/)?.[0] ?? message.author.id;
  const member = banner
    ? await message.guild.members.fetch({ user: id, force: true }).catch(() => null)
    : message.guild.members.cache.get(id) ?? (await message.guild.members.fetch(id).catch(() => null));
  const user = await message.client.users.fetch(id, { force: banner }).catch(() => null);
  if (!user) {
    await message.reply({ content: '❌ Membre introuvable.', allowedMentions: { repliedUser: false } }).catch(() => {});
    return true;
  }

  // Version du serveur si le membre en a une, sinon la version globale, en grand.
  const name = member?.displayName ?? user.username;
  const options = { size: 1024, extension: 'png', forceStatic: false };
  const url = banner ? member?.bannerURL(options) ?? user.bannerURL(options) : (member ?? user).displayAvatarURL(options);
  if (!url) {
    await message.reply({ content: `❌ ${name} n’a pas de bannière.`, allowedMentions: { repliedUser: false } }).catch(() => {});
    return true;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: `${banner ? 'Bannière' : 'Photo de profil'} de ${name}` })
    .setImage(url)
    .setFooter({ text: `Demandé par ${message.member?.displayName ?? message.author.username}` });

  await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => {});
  return true;
}

// Icône (photo de profil) ou bannière du serveur, en grand.
async function sendGuildImage(message, banner) {
  const { guild } = message;
  const options = { size: 1024, extension: 'png', forceStatic: false };
  const url = banner ? guild.bannerURL(options) : guild.iconURL(options);
  if (!url) {
    const what = banner ? 'de bannière' : 'de photo de profil';
    await message.reply({ content: `❌ Le serveur n’a pas ${what}.`, allowedMentions: { repliedUser: false } }).catch(() => {});
    return true;
  }
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({ name: `${banner ? 'Bannière' : 'Photo de profil'} de ${guild.name}` })
    .setImage(url)
    .setFooter({ text: `Demandé par ${message.member?.displayName ?? message.author.username}` });
  await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => {});
  return true;
}
