import { EmbedBuilder } from 'discord.js';
import { getXp, addXp, addMoney, addCoins, getRewardMark, setRewardMark } from './store.js';
import { levelFromXp, xpDeltaForLevels, syncLevelRoles } from './levels.js';
import { presenceText } from './autoroles.js';
import { wearsServerTag } from './tagrole.js';
import { sendLog, Colors } from './logger.js';
import { formatMoney } from './shop.js';

// Récompenses uniques (Hanami) : la pub dans le statut, le tag du serveur porté et le boost du serveur rapportent
// chacun, une seule fois par membre (même s'il l'enlève et le remet, ou quitte le serveur et revient), des
// niveaux, de l'argent et des coins. Statut et tag rapportent le double à un booster ; le boost rapporte toujours
// le double. Le membre est prévenu en MP et c'est noté dans les logs. Vérifié à chaque changement de présence,
// de profil (tag) ou de boost, et au démarrage pour ceux qui y ont déjà droit.
const BASE = {
  '1563159382361907350': { keywords: ['/hanamifr', '.gg/hanamifr'], levels: 3, money: 500, coins: 500 },
};
const isBooster = (member) => Boolean(member.premiumSinceTimestamp);
const KINDS = {
  status: {
    title: '🏷️ Récompense du statut',
    applies: (member, base) => base.keywords.some((k) => presenceText(member).includes(k)),
    thanks: (base) => `Merci d’avoir mis **${base.keywords[0]}** dans ton statut !`,
    what: (base) => `a mis **${base.keywords[0]}** dans son statut`,
    doubled: isBooster,
  },
  tag: {
    title: '🏷️ Récompense du tag',
    applies: (member) => wearsServerTag(member),
    thanks: () => 'Merci de porter le tag du serveur !',
    what: () => 'porte le tag du serveur',
    doubled: isBooster,
  },
  boost: {
    title: '🚀 Récompense du boost',
    applies: isBooster,
    thanks: () => 'Merci pour ton boost !',
    what: () => 'boost le serveur',
    doubled: () => true,
  },
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Renvoie true si la récompense vient d'être donnée.
export async function checkReward(member, kind) {
  const base = BASE[member?.guild?.id];
  const k = KINDS[kind];
  if (!base || !k || !member.user || member.user.bot) return false;
  const { guild, user } = member;
  if (getRewardMark(guild.id, kind, user.id)) return false;
  if (!k.applies(member, base)) return false;
  setRewardMark(guild.id, kind, user.id, Date.now()); // noté d'abord : jamais deux fois

  const factor = k.doubled(member) ? 2 : 1;
  const reward = { levels: base.levels * factor, money: base.money * factor, coins: base.coins * factor };
  // Niveaux ajoutés directement (comme /xp ajouter : rôles des paliers, sans l'argent des passages de niveau).
  const before = getXp(guild.id, user.id);
  const { after } = addXp(guild.id, user.id, xpDeltaForLevels(before, reward.levels));
  await syncLevelRoles(member, levelFromXp(after)).catch(() => {});
  addMoney(guild.id, user.id, reward.money);
  addCoins(guild.id, user.id, reward.coins);

  const gains =
    `**+${reward.levels} niveaux** (niveau ${levelFromXp(before)} → **${levelFromXp(after)}**), ` +
    `💰 **+${formatMoney(reward.money)}** et 🪙 **+${formatMoney(reward.coins)}**`;
  const bonus = factor > 1 && kind !== 'boost' ? ' (doublé parce que tu boostes le serveur 🚀)' : '';
  await user
    .send(`🎉 ${k.thanks(base)} Sur **${guild.name}**, tu reçois ${gains}${bonus}.\n-# C’est une récompense unique : une seule fois par membre.`)
    .catch(() => {});
  await sendLog(
    guild,
    new EmbedBuilder()
      .setColor(Colors.join)
      .setAuthor({ name: k.title, iconURL: user.displayAvatarURL() })
      .setDescription(`${user} (${user.tag}) ${k.what(base)} : ${gains}${factor > 1 && kind !== 'boost' ? ' (×2, booster)' : ''}.`)
      .setTimestamp(),
  ).catch(() => {});
  return true;
}

// Plusieurs récompenses d'un coup (le boost d'abord : statut et tag sont alors doublés). Renvoie le nombre donné.
export async function checkRewards(member, kinds = ['boost', 'status', 'tag']) {
  let given = 0;
  for (const kind of kinds) if (await checkReward(member, kind).catch((err) => (console.error('[récompenses]', err), false))) given++;
  return given;
}

// Au démarrage : les membres qui y ont déjà droit (une récompense par seconde au plus).
export async function sweepRewards(client) {
  for (const guildId of Object.keys(BASE)) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    for (const member of guild.members.cache.values()) {
      if (await checkRewards(member)) await sleep(1000);
    }
  }
}
