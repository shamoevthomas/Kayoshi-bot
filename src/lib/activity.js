import { EmbedBuilder } from 'discord.js';
import {
  getStatConfig,
  patchStatConfig,
  getActivityLeaderboard,
  getVoiceLeaderboard,
} from './store.js';
import { getWeekRange } from './week.js';
import { flushVoiceSessions } from './voiceactivity.js';

const MEDALS = ['🥇', '🥈', '🥉'];

function fmtDuration(seconds) {
  const totalMin = Math.floor(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
  return `${m} min`;
}

function rankLine(i, label) {
  const rank = MEDALS[i] ?? `**${i + 1}.**`;
  return `${rank} ${label}`;
}

export function buildStatEmbed(guild, cfg = getStatConfig(guild.id)) {
  const { start, end } = getWeekRange();

  const textTop = getActivityLeaderboard(guild.id, 10);
  const textLines = textTop.length
    ? textTop
        .map((r, i) => rankLine(i, `<@${r.userId}> — **${r.count}** message${r.count > 1 ? 's' : ''}`))
        .join('\n')
    : '_Aucun message cette semaine._';

  const voiceTop = getVoiceLeaderboard(guild.id, 10);
  const voiceLines = voiceTop.length
    ? voiceTop.map((r, i) => rankLine(i, `<@${r.userId}> — **${fmtDuration(r.seconds)}**`)).join('\n')
    : '_Aucune activité vocale cette semaine._';

  const embed = new EmbedBuilder()
    .setColor(0x131313)
    .setTitle('📊 Membres les plus actifs de la semaine')
    .addFields(
      { name: '💬 Messages', value: textLines, inline: false },
      { name: '🔊 Vocal', value: voiceLines, inline: false },
    )
    .setFooter({ text: `Semaine du ${start} au ${end} · actualisé toutes les 10 min` })
    .setTimestamp();

  const rewards = [];
  if (cfg?.textRoleId) rewards.push(`💬 1er messages → <@&${cfg.textRoleId}>`);
  if (cfg?.voiceRoleId) rewards.push(`🔊 1er vocal → <@&${cfg.voiceRoleId}>`);
  if (rewards.length) embed.addFields({ name: '🏅 Récompenses', value: rewards.join('\n'), inline: false });

  return embed;
}

async function resolveChannel(guild, channelId) {
  return guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
}

// Donne le rôle au nouveau 1er et le retire à l'ancien. Renvoie l'id du détenteur.
async function syncTopRole(guild, roleId, newTopId, oldTopId) {
  if (!roleId) return oldTopId ?? null;
  const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId).catch(() => null));
  if (!role) return oldTopId ?? null;

  if (oldTopId === newTopId) {
    // Rien n'a changé, mais on garantit que le détenteur a bien le rôle.
    if (newTopId) {
      const m = await guild.members.fetch(newTopId).catch(() => null);
      if (m && !m.roles.cache.has(role.id)) await m.roles.add(role).catch(() => {});
    }
    return newTopId ?? null;
  }
  if (oldTopId) {
    const prev = await guild.members.fetch(oldTopId).catch(() => null);
    if (prev) await prev.roles.remove(role).catch(() => {});
  }
  if (newTopId) {
    const m = await guild.members.fetch(newTopId).catch(() => null);
    if (m) await m.roles.add(role).catch(() => {});
  }
  return newTopId ?? null;
}

// Poste le message de classement dans un salon et renvoie son id.
export async function postStatMessage(guild, channel) {
  const msg = await channel.send({ embeds: [buildStatEmbed(guild)] });
  return msg.id;
}

// Met à jour le message + synchronise les rôles des 1ers.
export async function refreshStatMessage(client, guildId) {
  const cfg = getStatConfig(guildId);
  if (!cfg?.channelId) return;
  const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) return;

  // Rôles récompenses pour les 1ers.
  const textTop = getActivityLeaderboard(guildId, 1)[0]?.userId ?? null;
  const voiceTop = getVoiceLeaderboard(guildId, 1)[0]?.userId ?? null;
  const newText = await syncTopRole(guild, cfg.textRoleId, textTop, cfg.textTopId ?? null);
  const newVoice = await syncTopRole(guild, cfg.voiceRoleId, voiceTop, cfg.voiceTopId ?? null);
  if (newText !== (cfg.textTopId ?? null) || newVoice !== (cfg.voiceTopId ?? null)) {
    patchStatConfig(guildId, { textTopId: newText, voiceTopId: newVoice });
  }

  const channel = await resolveChannel(guild, cfg.channelId);
  if (!channel?.isTextBased()) return;
  const embed = buildStatEmbed(guild, cfg);
  const existing = cfg.messageId ? await channel.messages.fetch(cfg.messageId).catch(() => null) : null;
  if (existing) {
    await existing.edit({ embeds: [embed] }).catch(() => {});
  } else {
    const sent = await channel.send({ embeds: [embed] }).catch(() => null);
    if (sent) patchStatConfig(guildId, { messageId: sent.id });
  }
}

// Actualise le classement de tous les serveurs configurés.
export async function refreshAllStats(client) {
  flushVoiceSessions(); // fige le temps vocal en cours avant de classer
  for (const [guildId] of client.guilds.cache) {
    await refreshStatMessage(client, guildId).catch(() => {});
  }
}
