import { EmbedBuilder } from 'discord.js';
import { getStatConfig, setStatConfig, getActivityLeaderboard } from './store.js';
import { getWeekRange } from './week.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export function buildStatEmbed(guild) {
  const top = getActivityLeaderboard(guild.id, 10);
  const { start, end } = getWeekRange();
  const lines = top.length
    ? top
        .map((row, i) => {
          const rank = MEDALS[i] ?? `**${i + 1}.**`;
          return `${rank} <@${row.userId}> — **${row.count}** message${row.count > 1 ? 's' : ''}`;
        })
        .join('\n')
    : "_Aucun message enregistré pour l'instant cette semaine._";

  return new EmbedBuilder()
    .setColor(0x131313)
    .setTitle('📊 Membres les plus actifs de la semaine')
    .setDescription(lines)
    .setFooter({ text: `Semaine du ${start} au ${end} · actualisé toutes les 10 min` })
    .setTimestamp();
}

async function resolveChannel(guild, channelId) {
  return guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
}

// Poste le message de classement dans un salon et renvoie son id.
export async function postStatMessage(guild, channel) {
  const msg = await channel.send({ embeds: [buildStatEmbed(guild)] });
  return msg.id;
}

// Met à jour le message existant (ou le reposte s'il a été supprimé).
export async function refreshStatMessage(client, guildId) {
  const cfg = getStatConfig(guildId);
  if (!cfg?.channelId) return;
  const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) return;
  const channel = await resolveChannel(guild, cfg.channelId);
  if (!channel?.isTextBased()) return;

  const embed = buildStatEmbed(guild);
  const existing = cfg.messageId ? await channel.messages.fetch(cfg.messageId).catch(() => null) : null;
  if (existing) {
    await existing.edit({ embeds: [embed] }).catch(() => {});
  } else {
    const sent = await channel.send({ embeds: [embed] }).catch(() => null);
    if (sent) setStatConfig(guildId, { channelId: cfg.channelId, messageId: sent.id });
  }
}

// Actualise le classement de tous les serveurs configurés.
export async function refreshAllStats(client) {
  for (const [guildId] of client.guilds.cache) {
    await refreshStatMessage(client, guildId).catch(() => {});
  }
}
