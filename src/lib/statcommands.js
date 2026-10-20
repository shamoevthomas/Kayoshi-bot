import { AttachmentBuilder } from 'discord.js';
import { userStats, serverStats } from './stats.js';
import { flushVoiceSessions } from './voiceactivity.js';
import { renderUserCard, renderTopCard, renderActivityCard } from './statcards.js';

// Commandes de stats en message : s?u [membre], s?t, s?m, s?v (image dans le style de Statbot).
const COMMAND = /^s\?([utmv])(?:\s+(.*))?$/i;
const COOLDOWN_MS = 5000;
const lastUse = new Map(); // `${guildId}:${userId}` → horodatage

function channelName(guild, id) {
  return guild.channels.cache.get(id)?.name ?? 'salon supprimé';
}

// Nom affiché d'un membre dans les tops : son pseudo Discord (même s'il est parti).
async function memberNames(guild, ids) {
  const names = new Map();
  for (const id of ids) {
    const user = guild.members.cache.get(id)?.user ?? guild.client.users.cache.get(id) ?? (await guild.client.users.fetch(id).catch(() => null));
    names.set(id, user?.username ?? 'membre parti');
  }
  return names;
}

// Cible de s?u : la mention ou l'ID écrit après la commande (pas la personne à qui on
// répond), sinon un pseudo / nom d'affichage du serveur, sinon l'auteur du message.
async function targetUser(message, arg) {
  const text = arg?.trim();
  if (!text) return message.author;
  const id = text.match(/<@!?(\d{17,20})>/)?.[1] ?? text.match(/\b\d{17,20}\b/)?.[0];
  if (id) return message.client.users.fetch(id).catch(() => null);

  const query = text.replace(/^@/, '').toLowerCase();
  const sameName = (m) => [m.user.username, m.user.globalName, m.displayName].some((n) => n?.toLowerCase() === query);
  const cached = message.guild.members.cache.find(sameName);
  if (cached) return cached.user;
  const found = await message.guild.members.fetch({ query, limit: 10 }).catch(() => null);
  return (found?.find(sameName) ?? found?.first())?.user ?? null;
}

// Renvoie true si le message était une commande de stats (gérée ici).
export async function handleStatCommand(message) {
  if (!message.guild || message.author.bot) return false;
  const match = message.content.trim().match(COMMAND);
  if (!match) return false;

  const key = `${message.guild.id}:${message.author.id}`;
  if (Date.now() - (lastUse.get(key) ?? 0) < COOLDOWN_MS) return true;
  lastUse.set(key, Date.now());

  const { guild } = message;
  const kind = match[1].toLowerCase();
  await message.channel.sendTyping().catch(() => {});
  // Le temps passé en vocal par les membres encore connectés compte aussi.
  flushVoiceSessions();

  const botUser = message.client.user;
  const nameOf = (id) => channelName(guild, id);
  const messageChannel = (id) => `# ${nameOf(id)}`;
  let png;

  if (kind === 'u') {
    const user = await targetUser(message, match[2]);
    if (!user) {
      await message
        .reply({ content: '❌ Membre introuvable : mentionne-le (`s?u @membre`), ou donne son pseudo ou son ID.', allowedMentions: { repliedUser: false } })
        .catch(() => {});
      return true;
    }
    if (user.bot) {
      await message.reply({ content: '❌ Les bots n’ont pas de stats.', allowedMentions: { repliedUser: false } }).catch(() => {});
      return true;
    }
    const member = await guild.members.fetch(user.id).catch(() => null);
    const stats = userStats(guild.id, user.id);
    png = await renderUserCard({
      user,
      member,
      guild,
      stats,
      botUser,
      channelName: (id) => (id === stats.topMessageChannel?.id ? messageChannel(id) : nameOf(id)),
    });
  } else {
    const stats = serverStats(guild.id);
    const ids = [...stats.topMessageMembers, ...stats.topVoiceMembers].map((e) => e.id);
    const names = await memberNames(guild, ids);
    const memberName = (id) => names.get(id) ?? 'membre parti';
    if (kind === 't') {
      // Salons de messages précédés de « # », salons vocaux tels quels.
      const voiceIds = new Set(stats.topVoiceChannels.map((e) => e.id));
      png = await renderTopCard({ guild, stats, memberName, botUser, channelName: (id) => (voiceIds.has(id) ? nameOf(id) : messageChannel(id)) });
    } else {
      const isVoice = kind === 'v';
      png = await renderActivityCard({
        kind: isVoice ? 'voice' : 'messages',
        guild,
        stats,
        memberName,
        botUser,
        channelName: isVoice ? nameOf : messageChannel,
      });
    }
  }

  await message
    .reply({ files: [new AttachmentBuilder(png, { name: 'stats.png' })], allowedMentions: { repliedUser: false } })
    .catch(() => {});
  return true;
}
