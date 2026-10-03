import { getBumpReminder, patchBumpReminder, getAllBumpReminders } from './store.js';

// ID du bot Disboard (le même sur tous les serveurs).
export const DISBOARD_ID = '302050872383242240';
// Délai entre deux /bump sur Disboard.
export const BUMP_COOLDOWN = 2 * 60 * 60_000;

export const DEFAULT_REMINDER =
  '⏰ Le serveur peut de nouveau être bump ! Tapez `/bump` pour le faire remonter sur Disboard.';
export const DEFAULT_THANKS = 'Merci [membre] pour le bump ! 🚀 Prochain rappel dans 2 heures.';

export const BUMP_TEMPLATE_HELP =
  'Variables : `[membre]` (mention de la personne qui a bump) · `[user]` (son pseudo) · `[server]` (nom du serveur)';

// Message de rappel / de remerciement réellement utilisés (défaut si jamais
// modifié ; un message après bump vidé = aucun message).
export function reminderText(cfg) {
  return cfg.reminderMessage || DEFAULT_REMINDER;
}

export function thanksText(cfg) {
  return cfg.thanksMessage ?? DEFAULT_THANKS;
}

function applyTemplates(text, guild, bumperId, username) {
  return text
    .replace(/\[@\]/gi, bumperId ? `<@${bumperId}>` : '')
    .replace(/\[membre\]/gi, bumperId ? `<@${bumperId}>` : '')
    .replace(/\[user\]/gi, username ?? '')
    .replace(/\[server\]/gi, guild.name);
}

// Mention placée devant le rappel. Le rôle @everyone (même ID que le serveur)
// devient un vrai @everyone.
export function roleMention(guildId, roleId) {
  if (!roleId) return { text: '', allowed: { parse: [] } };
  if (roleId === guildId) return { text: '@everyone ', allowed: { parse: ['everyone'] } };
  return { text: `<@&${roleId}> `, allowed: { roles: [roleId] } };
}

// Réponse de Disboard à un /bump réussi : image « bump » (même dans toutes les
// langues) ou texte « Bump done » / « Bump effectué ». Les réponses d'attente
// (« Please wait another X minutes ») ne correspondent pas.
function isBumpSuccess(message) {
  return message.embeds.some(
    (e) => e.image?.url?.includes('bot-command-image-bump') || /bump (done|effectu)/i.test(e.description ?? ''),
  );
}

// À appeler sur messageCreate ET messageUpdate : Disboard répond parfois d'abord
// « réfléchit… » puis modifie son message avec le résultat.
export async function handleDisboardBump(message) {
  if (!message.guild || message.author?.id !== DISBOARD_ID) return;
  const cfg = getBumpReminder(message.guild.id);
  if (!cfg.enabled || cfg.lastBumpMessageId === message.id) return;
  if (!isBumpSuccess(message)) return;

  const bumper = message.interactionMetadata?.user ?? null;
  patchBumpReminder(message.guild.id, {
    channelId: message.channelId,
    nextAt: message.createdTimestamp + BUMP_COOLDOWN,
    lastBumperId: bumper?.id ?? null,
    lastBumpMessageId: message.id,
  });

  const thanks = thanksText(cfg);
  if (!thanks) return;
  await message.channel
    .send({
      content: applyTemplates(thanks, message.guild, bumper?.id, bumper?.username).slice(0, 2000),
      allowedMentions: { users: bumper ? [bumper.id] : [] },
    })
    .catch(() => {});
}

// Envoie les rappels arrivés à échéance (ticker lancé au démarrage). Un rappel
// manqué pendant que le bot était hors ligne part dès le redémarrage.
export async function processBumpReminders(client) {
  const now = Date.now();
  for (const { guildId, cfg } of getAllBumpReminders()) {
    if (!cfg.enabled || !cfg.nextAt || cfg.nextAt > now) continue;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    // Effacé AVANT l'envoi : jamais deux rappels pour le même bump.
    patchBumpReminder(guildId, { nextAt: null });

    const channel = guild.channels.cache.get(cfg.channelId) ?? (await guild.channels.fetch(cfg.channelId).catch(() => null));
    if (!channel?.isTextBased()) continue;

    const bumper = cfg.lastBumperId ? await client.users.fetch(cfg.lastBumperId).catch(() => null) : null;
    const { text, allowed } = roleMention(guildId, cfg.roleId);
    const body = applyTemplates(reminderText(cfg), guild, cfg.lastBumperId, bumper?.username);
    allowed.users = cfg.lastBumperId ? [cfg.lastBumperId] : [];
    await channel.send({ content: `${text}${body}`.slice(0, 2000), allowedMentions: allowed }).catch(() => {});
  }
}
