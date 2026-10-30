import { AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { userStats, serverStats, serverDays, bestFriends, activityHeatmap, memberRecap, lastDayKeys, FRIEND_DAYS } from './stats.js';
import { flushVoiceSessions } from './voiceactivity.js';
import { renderUserCard, renderTopCard, renderActivityCard, renderGraphCard, renderRecapCard, renderHeatmapCard } from './statcards.js';

// Commandes de stats en message : s?u [membre], s?t, s?m, s?v (image dans le style de Statbot), et :
//   « +graph [7|14|30] »           courbe d'activité du serveur jour par jour (30 jours par défaut)
//   « +recap [membre] [dernier] »  le mois en cours (ou le précédent) d'un membre, en image
//   « +heures »                    carte de chaleur des heures les plus actives (4 semaines)
//   « +meilleurami [membre] »      top 5 des membres avec qui il échange le plus (réponses et mentions, 30 jours)
const COMMAND = /^s\?([utmv])(?:\s+(.*))?$/i;
const GRAPH = /^\+graph(?:\s+(\d{1,2}))?$/i;
const RECAP = /^\+recap(?:\s+(.*))?$/i;
const HEURES = /^\+heures?$/i;
const FRIENDS = /^\+(?:meilleurs?amis?|bff)(?:\s+(.*))?$/i;
const LAST_MONTH = /\b(dernier|precedent|précédent|avant)\b/i;
const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
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
  const content = message.content.trim();
  const plus = [
    ['graph', content.match(GRAPH)],
    ['recap', content.match(RECAP)],
    ['heures', content.match(HEURES)],
    ['friends', content.match(FRIENDS)],
  ].find(([, m]) => m);
  const match = plus ? null : content.match(COMMAND);
  if (!plus && !match) return false;

  const key = `${message.guild.id}:${message.author.id}`;
  if (Date.now() - (lastUse.get(key) ?? 0) < COOLDOWN_MS) return true;
  lastUse.set(key, Date.now());

  const { guild } = message;
  if (plus) {
    await handlePlusStat(message, plus[0], plus[1]);
    return true;
  }
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

const sendImage = (message, png, name) =>
  message.reply({ files: [new AttachmentBuilder(png, { name })], allowedMentions: { repliedUser: false } }).catch(() => {});
const notFound = (message, usage) =>
  message.reply({ content: `❌ Membre introuvable : mentionne-le (\`${usage} @membre\`), ou donne son pseudo ou son ID.`, allowedMentions: { repliedUser: false } }).catch(() => {});

// +graph, +recap, +heures et +meilleurami.
async function handlePlusStat(message, kind, match) {
  const { guild } = message;
  const botUser = message.client.user;
  await message.channel.sendTyping().catch(() => {});
  // Le temps passé en vocal par les membres encore connectés compte aussi.
  flushVoiceSessions();

  if (kind === 'graph') {
    const n = Math.min(30, Math.max(7, Number(match[1] ?? 30)));
    return sendImage(message, await renderGraphCard({ guild, days: serverDays(guild.id, n), botUser }), 'activite.png');
  }

  if (kind === 'heures') return sendImage(message, await renderHeatmapCard({ guild, grid: activityHeatmap(guild.id), botUser }), 'heures.png');

  if (kind === 'recap') {
    // « dernier » (ou « précédent ») : le mois d'avant ; le reste désigne le membre.
    const arg = match[1] ?? '';
    const previous = LAST_MONTH.test(arg);
    const user = await targetUser(message, arg.replace(LAST_MONTH, '').trim());
    if (!user) return notFound(message, '+recap');
    if (user.bot) return message.reply({ content: '❌ Les bots n’ont pas de récap.', allowedMentions: { repliedUser: false } }).catch(() => {});
    const today = lastDayKeys(1)[0];
    let month = today.slice(0, 7);
    if (previous) {
      const [y, m] = month.split('-').map(Number);
      month = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    }
    const recap = memberRecap(guild.id, user.id, month);
    const member = await guild.members.fetch(user.id).catch(() => null);
    const names = await memberNames(guild, recap.bestFriend ? [recap.bestFriend.id] : []);
    const png = await renderRecapCard({
      user,
      member,
      guild,
      month,
      recap,
      botUser,
      channelName: (id) => channelName(guild, id),
      friendName: (id) => names.get(id) ?? 'membre parti',
    });
    return sendImage(message, png, `recap-${month}.png`);
  }

  // +meilleurami
  const user = await targetUser(message, match[1]);
  if (!user) return notFound(message, '+meilleurami');
  if (user.bot) return message.reply({ content: '❌ Les bots n’ont pas d’amis… enfin, pas comptés ici.', allowedMentions: { repliedUser: false } }).catch(() => {});
  const top = bestFriends(guild.id, user.id);
  const member = await guild.members.fetch(user.id).catch(() => null);
  const name = member?.displayName ?? user.globalName ?? user.username;
  const embed = new EmbedBuilder()
    .setColor(0xeb459e)
    .setAuthor({ name: `Meilleurs amis de ${name}`, iconURL: (member ?? user).displayAvatarURL() })
    .setDescription(
      top.length
        ? top
            .map((f, i) => `${MEDALS[i]} <@${f.id}> — **${f.total}** échange(s)\n-# ${f.sent} envoyé(s) · ${f.received} reçu(s)`)
            .join('\n')
        : `Pas encore d’échanges : réponds aux messages ou mentionne des membres, et reviens voir !`,
    )
    .setFooter({ text: `Réponses et mentions, dans les deux sens · ${FRIEND_DAYS} derniers jours` });
  return message.reply({ embeds: [embed], allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
}
