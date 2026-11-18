import { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
import { getGuildConfig, setGuildConfig } from './store.js';

// Recréer un salon à l'identique (/recreate, « +recreate [#salon] ») : clone (nom, permissions, catégorie, sujet,
// NSFW, mode lent…) remis à la même place, puis l'ancien est supprimé, avec tous ses messages. Les réglages du bot qui
// visaient l'ancien salon (salon partenariat, logs, tickets, one-message, sport…) suivent le nouveau.

// Toutes les mentions de l'ancien identifiant dans les réglages du serveur (valeurs, clés, « <#salon> » dans les
// textes) deviennent le nouveau : un identifiant de salon n'appartient qu'à ce salon.
function moveChannelSettings(guildId, oldId, newId) {
  const before = JSON.stringify(getGuildConfig(guildId));
  const after = before.split(`"${oldId}"`).join(`"${newId}"`).split(`<#${oldId}>`).join(`<#${newId}>`);
  if (after !== before) setGuildConfig(guildId, JSON.parse(after));
}

// Renvoie le nouveau salon (lève une erreur si Discord refuse).
export async function recreateChannel(channel, by) {
  const reason = `Salon recréé par ${by.tag}`;
  const position = channel.rawPosition;
  const clone = await channel.clone({ reason });
  await clone.setPosition(position).catch(() => {});
  await channel.delete(reason);
  moveChannelSettings(channel.guild.id, channel.id, clone.id);
  if (clone.isTextBased()) await clone.send({ content: `🧹 Salon recréé par ${by}.`, allowedMentions: { parse: [] } }).catch(() => {});
  return clone;
}

// Problème qui empêche de recréer ce salon, ou null.
export function recreateProblem(guild, channel) {
  if (!guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) return 'Il me manque la permission **Gérer les salons**.';
  if (!channel?.manageable) return `Je ne peux pas gérer ${channel ?? 'ce salon'} (permissions ou hiérarchie).`;
  return null;
}

export const confirmRow = () =>
  new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('recreate_yes').setLabel('Oui, recréer').setStyle(ButtonStyle.Danger).setEmoji('🧹'),
    new ButtonBuilder().setCustomId('recreate_no').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
  );

export const confirmText = (channel) =>
  `⚠️ Tu vas **supprimer puis recréer** ${channel} à l’identique (même nom, mêmes permissions). **Tous les messages seront perdus.** Confirmer ?`;

// « +recreate » (ce salon) ou « +recreate #salon » : staff avec « Gérer les salons », après confirmation.
export async function handleRecreateCommand(message) {
  if (!message.guild || message.author.bot) return false;
  const match = message.content.trim().match(/^\+recreate(?:\s+<#(\d+)>)?$/i);
  if (!match) return false;
  const reply = (content, extra = {}) => message.reply({ content, allowedMentions: { parse: [], repliedUser: false }, ...extra }).catch(() => null);
  if (!message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    await reply('❌ Il te faut la permission **Gérer les salons**.');
    return true;
  }
  const channel = match[1] ? message.guild.channels.cache.get(match[1]) : message.channel;
  const problem = recreateProblem(message.guild, channel);
  if (problem) {
    await reply(`❌ ${problem}`);
    return true;
  }
  const prompt = await reply(confirmText(channel), { components: [confirmRow()] });
  const choice = await prompt
    ?.awaitMessageComponent({ filter: (i) => i.user.id === message.author.id && i.customId.startsWith('recreate_'), time: 30_000 })
    .catch(() => null);
  if (!choice) {
    await prompt?.edit({ content: '⏳ Temps écoulé, opération annulée.', components: [] }).catch(() => {});
    return true;
  }
  if (choice.customId === 'recreate_no') {
    await choice.update({ content: '❌ Opération annulée.', components: [] }).catch(() => {});
    return true;
  }
  await choice.update({ content: '⏳ Recréation du salon…', components: [] }).catch(() => {});
  try {
    const clone = await recreateChannel(channel, message.author);
    // Salon recréé ailleurs que celui de la commande : la confirmation y reste.
    if (channel.id !== message.channel.id) await prompt.edit({ content: `✅ ${clone} a été recréé (même nom, mêmes permissions).` }).catch(() => {});
  } catch (err) {
    console.error('[recreate] échec :', err);
    await prompt?.edit({ content: `❌ Échec : ${err?.message ?? 'erreur inconnue'}` }).catch(() => {});
  }
  return true;
}
