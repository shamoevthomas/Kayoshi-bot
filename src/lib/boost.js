import { getBoostConfig } from './store.js';

export const BOOST_TEMPLATE_HELP =
  'Variables : `[@]`/`[membre]` (mention) · `[user]` (pseudo) · `[server]` (nom du serveur) · `[count]` (nombre de boosts)';

function applyTemplates(text, member) {
  const g = member.guild;
  return text
    .replace(/\[@\]/gi, `<@${member.id}>`)
    .replace(/\[membre\]/gi, `<@${member.id}>`)
    .replace(/\[user\]/gi, member.user.username)
    .replace(/\[server\]/gi, g.name)
    .replace(/\[count\]/gi, String(g.premiumSubscriptionCount ?? 0));
}

function mentionPrefix(config) {
  if (config.mentionType === 'everyone') return { text: '@everyone ', allowed: { parse: ['everyone'] } };
  if (config.mentionType === 'here') return { text: '@here ', allowed: { parse: ['everyone'] } };
  if (config.mentionType === 'role' && config.roleId) return { text: `<@&${config.roleId}> `, allowed: { roles: [config.roleId] } };
  return { text: '', allowed: { parse: [] } };
}

// Envoie le message de boost si le membre vient de commencer à booster.
export async function handleBoost(oldMember, newMember) {
  // Passage de "ne boost pas" à "boost" (premiumSince apparaît).
  if (oldMember.premiumSince || !newMember.premiumSince) return;

  const config = getBoostConfig(newMember.guild.id);
  if (!config?.channelId || !config.message) return;

  const channel =
    newMember.guild.channels.cache.get(config.channelId) ??
    (await newMember.guild.channels.fetch(config.channelId).catch(() => null));
  if (!channel?.isTextBased()) return;

  const { text, allowed } = mentionPrefix(config);
  const body = applyTemplates(config.message, newMember);
  // La mention du membre qui boost est toujours autorisée.
  allowed.users = [newMember.id];

  await channel.send({ content: `${text}${body}`.slice(0, 2000), allowedMentions: allowed }).catch(() => {});
}
