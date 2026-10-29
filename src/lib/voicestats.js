import { EmbedBuilder } from 'discord.js';
import { Colors } from './logger.js';

// « +vc » : statistiques du serveur (bots exclus) — membres, en ligne, en vocal, actifs (en vocal, ni mute
// ni en sourdine), en stream et mute (micro coupé ou en sourdine). Renvoie true si le message était la commande.
export async function handleVoiceStatsCommand(message) {
  if (!message.guild || message.author.bot) return false;
  if (message.content.trim().toLowerCase() !== '+vc') return false;
  const { guild } = message;

  // Tous les membres en cache, pour compter les membres et les présences sans les bots.
  if (guild.members.cache.size < guild.memberCount) await guild.members.fetch().catch(() => {});
  const isBot = (id) => guild.members.cache.get(id)?.user.bot;
  const members = guild.members.cache.filter((m) => !m.user.bot).size;
  const online = guild.presences.cache.filter((p) => p.status !== 'offline' && !isBot(p.userId)).size;
  const states = guild.voiceStates.cache.filter((s) => s.channelId && !isBot(s.id));
  const count = (test) => states.filter(test).size;

  const embed = new EmbedBuilder()
    .setColor(Colors.role)
    .setTitle(`Statistiques de ${guild.name}`)
    .setThumbnail(guild.iconURL({ size: 256 }) ?? null)
    .setDescription(
      [
        `Membres : **${members}**`,
        `En Ligne : **${online}**`,
        `En Vocal : **${states.size}**`,
        `Actif : **${count((s) => !s.mute && !s.deaf)}**`,
        `En Stream : **${count((s) => s.streaming)}**`,
        `Mute : **${count((s) => s.mute || s.deaf)}**`,
      ].join('\n'),
    );

  await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => {});
  return true;
}
