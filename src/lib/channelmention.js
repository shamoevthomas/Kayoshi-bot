import { PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getNoMentionChannels } from './store.js';
import { sendLog, Colors } from './logger.js';

// Supprime le message s'il mentionne un salon protégé. Renvoie true si géré.
export async function handleProtectedChannelMention(message) {
  if (!message.guild || message.author.bot || !message.member) return false;
  const ids = getNoMentionChannels(message.guild.id);
  if (!ids.length) return false;
  // Le staff (Gérer les messages) n'est pas concerné.
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return false;

  const mentioned = [...message.content.matchAll(/<#(\d+)>/g)].map((m) => m[1]);
  const hit = mentioned.find((id) => ids.includes(id));
  if (!hit) return false;

  await message.delete().catch(() => {});
  const warn = await message.channel.send(`❌ ${message.author}, tu ne peux pas mentionner ce salon.`).catch(() => null);
  if (warn) setTimeout(() => warn.delete().catch(() => {}), 5000);

  await sendLog(
    message.guild,
    new EmbedBuilder()
      .setColor(Colors.delete)
      .setAuthor({ name: '🔗 Mention de salon bloquée' })
      .setDescription(`Message de ${message.author} supprimé dans ${message.channel}`)
      .addFields(
        { name: 'Salon mentionné', value: `<#${hit}>`, inline: true },
        { name: 'Contenu', value: message.content.slice(0, 1000) },
      )
      .setTimestamp(),
  );
  return true;
}
