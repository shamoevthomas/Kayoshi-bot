import { EmbedBuilder } from 'discord.js';
import { getXp, addXp, addMoney, addCoins, getStatusRewarded, setStatusRewarded } from './store.js';
import { levelFromXp, xpDeltaForLevels, syncLevelRoles } from './levels.js';
import { presenceText } from './autoroles.js';
import { sendLog, Colors } from './logger.js';
import { formatMoney } from './shop.js';

// Récompense de pub dans le statut : un membre qui met un des mots-clés dans son statut reçoit, une seule fois
// (même s'il l'enlève et le remet, ou quitte le serveur et revient), des niveaux, de l'argent et des coins.
// Il est prévenu en MP et c'est noté dans les logs. Vérifié à chaque changement de présence (presenceUpdate)
// et au démarrage pour ceux qui l'ont déjà. Propre à Hanami.
const REWARDS = {
  '1563159382361907350': { keywords: ['/hanamifr', '.gg/hanamifr'], levels: 3, money: 500, coins: 500 },
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Renvoie true si la récompense vient d'être donnée.
export async function checkStatusReward(member) {
  const reward = REWARDS[member?.guild?.id];
  if (!reward || !member.user || member.user.bot) return false;
  const { guild, user } = member;
  if (getStatusRewarded(guild.id, user.id)) return false;
  const text = presenceText(member);
  if (!reward.keywords.some((k) => text.includes(k))) return false;
  setStatusRewarded(guild.id, user.id, Date.now()); // noté d'abord : jamais deux fois

  // Niveaux ajoutés directement (comme /xp ajouter : rôles des paliers, sans l'argent des passages de niveau).
  const before = getXp(guild.id, user.id);
  const { after } = addXp(guild.id, user.id, xpDeltaForLevels(before, reward.levels));
  await syncLevelRoles(member, levelFromXp(after)).catch(() => {});
  addMoney(guild.id, user.id, reward.money);
  addCoins(guild.id, user.id, reward.coins);

  const gains = `**+${reward.levels} niveaux** (niveau ${levelFromXp(before)} → **${levelFromXp(after)}**), 💰 **+${formatMoney(reward.money)}** et 🪙 **+${formatMoney(reward.coins)}**`;
  await user
    .send(`🎉 Merci d’avoir mis **${reward.keywords[0]}** dans ton statut ! Sur **${guild.name}**, tu reçois ${gains}.\n-# C’est une récompense unique : une seule fois par membre.`)
    .catch(() => {});
  await sendLog(
    guild,
    new EmbedBuilder()
      .setColor(Colors.join)
      .setAuthor({ name: '🏷️ Récompense du statut', iconURL: user.displayAvatarURL() })
      .setDescription(`${user} (${user.tag}) a mis **${reward.keywords[0]}** dans son statut : ${gains}.`)
      .setTimestamp(),
  ).catch(() => {});
  return true;
}

// Au démarrage : les membres qui ont déjà le mot-clé dans leur statut (une récompense par seconde au plus).
export async function sweepStatusRewards(client) {
  for (const guildId of Object.keys(REWARDS)) {
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    for (const member of guild.members.cache.values()) {
      if (await checkStatusReward(member).catch(() => false)) await sleep(1000);
    }
  }
}
