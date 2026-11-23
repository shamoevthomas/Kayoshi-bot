import { EmbedBuilder } from 'discord.js';

// « +vc » : statistiques du serveur — membres (bots exclus), en ligne, en vocal, en stream, actifs (en vocal, ni mute
// ni en sourdine) et mute (micro coupé ou en sourdine), avec la photo du serveur. Les chiffres du vocal comptent les
// membres et les bots ensemble (bots de musique…) ; « membres » et « en ligne » ne comptent que les membres.
// Renvoie true si le message était la commande.
export async function handleVoiceStatsCommand(message) {
  if (!message.guild || message.author.bot) return false;
  if (message.content.trim().toLowerCase() !== '+vc') return false;
  const { guild } = message;

  // Tous les membres en cache, pour compter les membres et les présences sans les bots.
  if (guild.members.cache.size < guild.memberCount) await guild.members.fetch().catch(() => {});
  const isBot = (id) => guild.members.cache.get(id)?.user.bot;
  const members = guild.members.cache.filter((m) => !m.user.bot).size;
  const online = guild.presences.cache.filter((p) => p.status !== 'offline' && !isBot(p.userId)).size;
  const states = guild.voiceStates.cache.filter((s) => s.channelId);
  const count = (test) => states.filter(test).size;
  const line = (label, n) => `*${label} :* **${n.toLocaleString('fr-FR')}**`;

  const embed = new EmbedBuilder()
    .setTitle(`${guild.name} Statistiques !`)
    .setThumbnail(guild.iconURL({ size: 256 }) ?? null)
    .setDescription(
      [
        line('Membres', members),
        line('En ligne', online),
        line('En vocal', states.size),
        line('En stream', count((s) => s.streaming)),
        line('Actifs', count((s) => !s.mute && !s.deaf)),
        line('Mute', count((s) => s.mute || s.deaf)),
      ].join('\n'),
    );

  await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => {});
  return true;
}
