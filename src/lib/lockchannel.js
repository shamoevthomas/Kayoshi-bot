import { ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getLockdown, setLockdown } from './store.js';
import { sendLog, Colors } from './logger.js';
import { lockRole } from './roles.js';

// « +lock [raison] » / « +unlock » (staff : Gérer les salons) : verrouille ou déverrouille l'écriture dans ce
// salon pour le rôle des membres (lib/roles.js). Noté dans les logs.
// « +lockdown [raison] » / « +unlockdown » : la même chose dans tous les salons à la fois (raid…), voir plus bas.
const reply = (message, content) => message.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});

export async function handleLockCommand(message) {
  if (!message.guild || message.author.bot) return false;
  const [cmd, ...rest] = message.content.trim().split(/\s+/);
  const lock = cmd.toLowerCase() === '+lock';
  if (!lock && cmd.toLowerCase() !== '+unlock') return false;
  // Réservé au staff : les autres sont ignorés sans réponse.
  if (!message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) return true;

  const channel = message.channel.isThread?.() ? message.channel.parent : message.channel;
  const role = lockRole(message.guild);
  const reason = rest.join(' ').trim() || null;
  try {
    await channel.permissionOverwrites.edit(role, { SendMessages: lock ? false : null }, { reason: `${cmd.toLowerCase()} par ${message.author.tag}` });
  } catch {
    await reply(message, `❌ Je n’ai pas pu modifier ${channel} (il me faut la permission « Gérer les rôles » sur ce salon).`);
    return true;
  }

  const embed = new EmbedBuilder()
    .setColor(lock ? Colors.delete : Colors.join)
    .setAuthor({ name: lock ? '🔒 Salon verrouillé' : '🔓 Salon déverrouillé' })
    .setDescription(`${channel} (pour ${role})`)
    .setTimestamp();
  if (lock) embed.addFields({ name: 'Raison', value: reason ?? 'Aucune raison précisée' });
  embed.addFields({ name: 'Par', value: `${message.author}`, inline: true });
  await sendLog(message.guild, embed).catch(() => {});

  await reply(message, lock ? `🔒 Salon verrouillé.${reason ? `\nRaison : ${reason}` : ''}` : '🔓 Salon déverrouillé.');
  return true;
}

// --- Lockdown : tous les salons où le rôle des membres peut écrire sont verrouillés d'un coup. L'état d'avant
// de chaque salon est enregistré (au fur et à mesure, pour survivre à un redémarrage) : +unlockdown remet
// exactement ce qu'il y avait, et les salons déjà fermés à l'écriture (annonces, règles…) ne sont pas touchés.
const WRITABLE = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
]);
const { SendMessages, SendMessagesInThreads, ViewChannel } = PermissionFlagsBits;
const before = (overwrite, flag) => (overwrite?.allow.has(flag) ? 'allow' : overwrite?.deny.has(flag) ? 'deny' : 'neutral');
const restore = (state) => (state === 'allow' ? true : state === 'deny' ? false : null);

export async function handleLockdownCommand(message) {
  if (!message.guild || message.author.bot) return false;
  const [cmd, ...rest] = message.content.trim().split(/\s+/);
  const down = cmd.toLowerCase() === '+lockdown';
  if (!down && cmd.toLowerCase() !== '+unlockdown') return false;
  if (!message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) return true;

  const { guild, author } = message;
  const role = lockRole(guild);
  const auditReason = `${cmd.toLowerCase()} par ${author.tag}`;
  const current = getLockdown(guild.id);

  if (down) {
    if (current) {
      await reply(message, `ℹ️ Le serveur est déjà en lockdown depuis <t:${Math.floor(current.at / 1000)}:R>. Pour rouvrir : \`+unlockdown\`.`);
      return true;
    }
    const reason = rest.join(' ').trim() || null;
    const targets = [...guild.channels.cache.values()].filter((c) => WRITABLE.has(c.type) && c.permissionsFor(role)?.has([ViewChannel, SendMessages]));
    const status = await message.reply({ content: `🔒 Lockdown en cours sur **${targets.length}** salon(s)…`, allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
    const lockdown = { at: Date.now(), by: author.id, reason, channels: {} };
    setLockdown(guild.id, lockdown);
    let failed = 0;
    for (const channel of targets) {
      const overwrite = channel.permissionOverwrites.cache.get(role.id);
      const state = { send: before(overwrite, SendMessages), threads: before(overwrite, SendMessagesInThreads) };
      try {
        await channel.permissionOverwrites.edit(role, { SendMessages: false, SendMessagesInThreads: false }, { reason: auditReason });
        lockdown.channels[channel.id] = state;
        setLockdown(guild.id, lockdown);
      } catch {
        failed++;
      }
    }
    const done = Object.keys(lockdown.channels).length;
    const text =
      `🔒 **Lockdown** : ${done} salon(s) verrouillé(s) pour ${role}${failed ? ` (${failed} impossible(s) à modifier)` : ''}.` +
      `${reason ? `\nRaison : ${reason}` : ''}\n-# Pour tout rouvrir comme avant : \`+unlockdown\`.`;
    await (status ? status.edit({ content: text, allowedMentions: { parse: [] } }) : reply(message, text)).catch(() => {});
    await sendLog(
      guild,
      new EmbedBuilder()
        .setColor(Colors.delete)
        .setAuthor({ name: '🔒 Lockdown du serveur' })
        .setDescription(`${done} salon(s) verrouillé(s) pour ${role}`)
        .addFields({ name: 'Raison', value: reason ?? 'Aucune raison précisée' }, { name: 'Par', value: `${author}`, inline: true })
        .setTimestamp(),
    ).catch(() => {});
    return true;
  }

  if (!current) {
    await reply(message, 'ℹ️ Aucun lockdown en cours.');
    return true;
  }
  const entries = Object.entries(current.channels ?? {});
  const status = await message.reply({ content: `🔓 Réouverture de **${entries.length}** salon(s)…`, allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
  let restored = 0;
  const left = {};
  for (const [id, state] of entries) {
    const channel = guild.channels.cache.get(id);
    if (!channel) continue; // salon supprimé entre-temps
    try {
      await channel.permissionOverwrites.edit(role, { SendMessages: restore(state.send), SendMessagesInThreads: restore(state.threads) }, { reason: auditReason });
      restored++;
    } catch {
      left[id] = state;
    }
  }
  // Ce qui n'a pas pu être rouvert reste noté : un nouveau +unlockdown réessaiera.
  setLockdown(guild.id, Object.keys(left).length ? { ...current, channels: left } : null);
  const failed = Object.keys(left).length;
  const text = `🔓 **Fin du lockdown** : ${restored} salon(s) rouvert(s) comme avant pour ${role}.${failed ? `\n⚠️ ${failed} salon(s) n’ont pas pu être rouverts : refais \`+unlockdown\`.` : ''}`;
  await (status ? status.edit({ content: text, allowedMentions: { parse: [] } }) : reply(message, text)).catch(() => {});
  await sendLog(
    guild,
    new EmbedBuilder()
      .setColor(Colors.join)
      .setAuthor({ name: '🔓 Fin du lockdown' })
      .setDescription(`${restored} salon(s) rouvert(s) pour ${role}`)
      .addFields({ name: 'Par', value: `${author}`, inline: true })
      .setTimestamp(),
  ).catch(() => {});
  return true;
}
