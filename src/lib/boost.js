import { MessageType } from 'discord.js';
import { getBoostConfig } from './store.js';

// Message de boost (/configboost). Chaque boost est repéré par le message système de Discord
// (« X vient de booster le serveur ») : un par boost, y compris quand un membre qui boostait déjà
// re-boost. Le début d'un boost (premiumSince) sert de secours si ces messages système sont
// désactivés. On attend 10 s après le premier boost : plusieurs boosts d'affilée du même membre
// ne donnent qu'un seul message (et [count] affiche alors le bon total).
const WAIT_MS = 10_000;
const BOOST_MESSAGES = new Set([MessageType.GuildBoost, MessageType.GuildBoostTier1, MessageType.GuildBoostTier2, MessageType.GuildBoostTier3]);
const pending = new Map(); // `${guildId}:${userId}` → { member, boosts }

export const BOOST_TEMPLATE_HELP =
  'Variables : `[@]`/`[membre]` (mention) · `[user]` (pseudo) · `[server]` (nom du serveur) · `[count]` (nombre de boosts du serveur) · `[boosts]` (boosts faits d’un coup)';

function applyTemplates(text, member, boosts) {
  const g = member.guild;
  return text
    .replace(/\[@\]/gi, `<@${member.id}>`)
    .replace(/\[membre\]/gi, `<@${member.id}>`)
    .replace(/\[user\]/gi, member.user.username)
    .replace(/\[server\]/gi, g.name)
    .replace(/\[count\]/gi, String(g.premiumSubscriptionCount ?? 0))
    .replace(/\[boosts\]/gi, String(boosts));
}

function mentionPrefix(config) {
  if (config.mentionType === 'everyone') return { text: '@everyone ', allowed: { parse: ['everyone'] } };
  if (config.mentionType === 'here') return { text: '@here ', allowed: { parse: ['everyone'] } };
  if (config.mentionType === 'role' && config.roleId) return { text: `<@&${config.roleId}> `, allowed: { roles: [config.roleId] } };
  return { text: '', allowed: { parse: [] } };
}

// Un boost de `member` : programme le message (10 s plus tard) ou s'ajoute à celui en attente.
// fromSystem = message système de Discord (compte le nombre de boosts) ; sinon début du boost.
function queueBoost(member, boosts, fromSystem) {
  const key = `${member.guild.id}:${member.id}`;
  const entry = pending.get(key);
  if (entry) {
    if (fromSystem) entry.boosts += boosts;
    entry.member = member;
    return;
  }
  pending.set(key, { member, boosts: fromSystem ? boosts : 0 });
  setTimeout(() => sendBoostMessage(key).catch((err) => console.error('[boost]', err)), WAIT_MS);
}

async function sendBoostMessage(key) {
  const entry = pending.get(key);
  pending.delete(key);
  if (!entry) return;
  const { member } = entry;
  const config = getBoostConfig(member.guild.id);
  if (!config?.channelId || !config.message) return;

  const channel = member.guild.channels.cache.get(config.channelId) ?? (await member.guild.channels.fetch(config.channelId).catch(() => null));
  if (!channel?.isTextBased()) return;

  const { text, allowed } = mentionPrefix(config);
  const body = applyTemplates(config.message, member, Math.max(1, entry.boosts));
  // La mention du membre qui boost est toujours autorisée.
  allowed.users = [member.id];
  await channel.send({ content: `${text}${body}`.slice(0, 2000), allowedMentions: allowed }).catch(() => {});
}

// Message système « … a boosté le serveur » (son texte est le nombre de boosts s'il y en a plusieurs).
// Renvoie true si c'en était un.
export async function handleBoostSystemMessage(message) {
  if (!message.guild || !BOOST_MESSAGES.has(message.type)) return false;
  const member = message.member ?? (await message.guild.members.fetch(message.author.id).catch(() => null));
  if (member) queueBoost(member, Number(message.content) || 1, true);
  return true;
}

// Secours : le membre vient de commencer à booster (premiumSince apparaît).
export async function handleBoost(oldMember, newMember) {
  if (oldMember.premiumSince || !newMember.premiumSince) return;
  queueBoost(newMember, 1, false);
}
