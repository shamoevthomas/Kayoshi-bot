import { EmbedBuilder } from 'discord.js';
import { Colors } from './logger.js';

// « +vc » : nombre de personnes en vocal, mute, en sourdine, en partage d'écran et
// avec la caméra (bots exclus). Renvoie true si le message était la commande.
export async function handleVoiceStatsCommand(message) {
  if (!message.guild || message.author.bot) return false;
  if (message.content.trim().toLowerCase() !== '+vc') return false;

  const states = message.guild.voiceStates.cache.filter((s) => s.channelId && !s.member?.user.bot);
  const count = (test) => states.filter(test).size;
  const total = states.size;

  const embed = new EmbedBuilder()
    .setColor(Colors.role)
    .setAuthor({ name: `🔊 Vocal — ${message.guild.name}`, iconURL: message.guild.iconURL() ?? undefined })
    .setDescription(
      `**${total}** personne${total > 1 ? 's' : ''} en vocal\n\n` +
        // Se mettre en sourdine coupe aussi le micro : les personnes en sourdine ne sont comptées qu'une fois.
        `🎙️ Mute : **${count((s) => s.mute && !s.deaf)}**\n` +
        `🎧 En sourdine : **${count((s) => s.deaf)}**\n` +
        `🖥️ Partage d’écran : **${count((s) => s.streaming)}**\n` +
        `📷 Caméra : **${count((s) => s.selfVideo)}**`,
    )
    .setTimestamp();

  await message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => {});
  return true;
}
