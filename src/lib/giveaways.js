import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  getGiveaway,
  updateGiveaway,
  addGiveawayParticipant,
  removeGiveawayParticipant,
  getAllGiveaways,
  getInviteTotal,
} from './store.js';

// Texte visible de la présence (statut perso + activités), en minuscules.
function statusText(member) {
  const parts = [];
  for (const a of member?.presence?.activities ?? []) {
    if (a.state) parts.push(a.state);
    if (a.name) parts.push(a.name);
    if (a.details) parts.push(a.details);
  }
  return parts.join(' ').toLowerCase();
}

// Invitations gagnées depuis le lancement du giveaway.
function invitesGained(gw, guildId, userId) {
  const base = gw.inviteBaseline?.[userId] ?? 0;
  return Math.max(0, getInviteTotal(guildId, userId) - base);
}

const GW_COLOR = 0x131313; // noir
const MAX_DELAY = 2_147_483_647; // limite de setTimeout (~24,8 j)
const timers = new Map(); // messageId -> timeout

function clearTimer(messageId) {
  const t = timers.get(messageId);
  if (t) clearTimeout(t);
  timers.delete(messageId);
}

// --- Rendu ---
export function buildJoinRow(count = 0, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('gw_join')
      .setEmoji('🎉')
      .setLabel('Participer')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId('gw_list')
      .setEmoji('👥')
      .setLabel(`${count} participant${count > 1 ? 's' : ''}`)
      .setStyle(ButtonStyle.Secondary),
  );
}

// Met à jour le compteur du bouton participants sur le message du giveaway.
async function refreshParticipantCount(channel, guildId, messageId) {
  const gw = getGiveaway(guildId, messageId);
  if (!gw || gw.ended || !channel?.isTextBased?.()) return;
  const msg = await channel.messages.fetch(messageId).catch(() => null);
  if (msg) await msg.edit({ components: [buildJoinRow(gw.participants?.length ?? 0)] }).catch(() => {});
}

// Rafraîchit le compteur de participants sur le message d'un giveaway
// (utilisé après un retrait manuel via /gw retirer-participant).
export async function refreshGiveawayCount(client, guildId, messageId) {
  const gw = getGiveaway(guildId, messageId);
  if (!gw) return;
  const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) return;
  const channel = guild.channels.cache.get(gw.channelId) ?? (await guild.channels.fetch(gw.channelId).catch(() => null));
  if (channel?.isTextBased()) await refreshParticipantCount(channel, guildId, messageId);
}

export function buildGiveawayEmbed(gw, ended = false) {
  const embed = new EmbedBuilder()
    .setColor(ended ? 0x2b2d31 : GW_COLOR)
    .setTitle(ended ? '🎉 GIVEAWAY TERMINÉ 🎉' : '🎉 GIVEAWAY 🎉')
    .setDescription(ended ? 'Le giveaway est terminé.' : 'Clique sur 🎉 **Participer** pour tenter ta chance !')
    .addFields(
      { name: '🎁 Prix', value: `**${gw.prize}**`, inline: false },
      { name: '🏆 Gagnant(s)', value: `${gw.winners}`, inline: true },
      ended
        ? {
            name: '🏆 Gagnant(s) tiré(s)',
            value: gw.winnerIds?.length ? gw.winnerIds.map((id) => `<@${id}>`).join(', ') : 'Aucun',
            inline: true,
          }
        : { name: '⏳ Fin', value: `<t:${Math.floor(gw.endsAt / 1000)}:R>`, inline: true },
      { name: '🎟️ Organisé par', value: `<@${gw.hostId}>`, inline: true },
    )
    .setTimestamp();

  const conditions = [];
  if (gw.requiredMessages) conditions.push(`✉️ **${gw.requiredMessages}** message(s) depuis le début`);
  if (gw.requiredInvites) conditions.push(`📨 **${gw.requiredInvites}** invitation(s) depuis le début`);
  if (gw.requiredStatus) conditions.push(`📝 avoir \`${gw.requiredStatus}\` dans son statut`);
  if (conditions.length) {
    embed.addFields({ name: '📋 Conditions pour participer', value: conditions.join('\n'), inline: false });
  }
  return embed;
}

// --- Tirage ---
function pickWinners(gw, count, exclude = []) {
  const eligible = (gw.participants ?? []).filter((id) => {
    if (exclude.includes(id)) return false;
    if (gw.requiredMessages) return (gw.messageCounts?.[id] ?? 0) >= gw.requiredMessages;
    return true;
  });
  const pool = [...eligible];
  const winners = [];
  while (winners.length < count && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(i, 1)[0]);
  }
  return winners;
}

async function resolveChannel(client, gw) {
  const guild = client.guilds.cache.get(gw.guildId) ?? (await client.guilds.fetch(gw.guildId).catch(() => null));
  if (!guild) return null;
  return guild.channels.cache.get(gw.channelId) ?? (await guild.channels.fetch(gw.channelId).catch(() => null));
}

async function announceWinners(channel, gw, winners, reroll = false) {
  if (!winners.length) {
    await channel
      .send(`😔 Aucun participant éligible pour le giveaway **${gw.prize}**. Pas de gagnant cette fois.`)
      .catch(() => {});
    return;
  }
  const mentions = winners.map((id) => `<@${id}>`).join(' ');
  const plural = winners.length > 1;
  const gagne = plural ? 'vous avez gagné' : 'tu as gagné';
  const votre = plural ? 'votre' : 'ton';
  const prefix = reroll ? '🔁 **Nouveau tirage !** ' : '';
  await channel
    .send({
      content: `${prefix}🎉 Bien joué ${mentions}, ${gagne} **${gw.prize}** ! Va MP <@${gw.hostId}> pour recevoir ${votre} prix.`,
      allowedMentions: { users: [...new Set([...winners, gw.hostId])] },
    })
    .catch(() => {});
}

// Termine un giveaway maintenant : tire les gagnants, met à jour le message, annonce.
export async function endGiveawayNow(client, guildId, messageId) {
  const stored = getGiveaway(guildId, messageId);
  if (!stored || stored.ended) return null;
  const gw = { ...stored, guildId };

  const winners = pickWinners(gw, gw.winners);
  updateGiveaway(guildId, messageId, { ended: true, winnerIds: winners });
  clearTimer(messageId);

  const channel = await resolveChannel(client, gw);
  if (channel?.isTextBased()) {
    const msg = await channel.messages.fetch(messageId).catch(() => null);
    if (msg) {
      await msg
        .edit({
          embeds: [buildGiveawayEmbed({ ...gw, winnerIds: winners }, true)],
          components: [buildJoinRow(gw.participants?.length ?? 0, true)],
        })
        .catch(() => {});
    }
    await announceWinners(channel, gw, winners);
  }
  return winners;
}

// Retire un nouveau gagnant (parmi les éligibles non déjà tirés).
export async function rerollGiveaway(client, guildId, messageId) {
  const stored = getGiveaway(guildId, messageId);
  if (!stored) return { ok: false, reason: 'not-found' };
  if (!stored.ended) return { ok: false, reason: 'not-ended' };
  const gw = { ...stored, guildId };

  let winners = pickWinners(gw, gw.winners, gw.winnerIds ?? []);
  if (!winners.length) winners = pickWinners(gw, gw.winners); // repli : tout le monde
  if (!winners.length) return { ok: false, reason: 'no-eligible' };

  updateGiveaway(guildId, messageId, { winnerIds: winners });

  const channel = await resolveChannel(client, gw);
  if (channel?.isTextBased()) await announceWinners(channel, gw, winners, true);
  return { ok: true, winners };
}

// --- Planification / reprise ---
export function scheduleGiveaway(client, guildId, messageId, endsAt) {
  clearTimer(messageId);
  const delay = endsAt - Date.now();
  if (delay <= 0) {
    endGiveawayNow(client, guildId, messageId).catch(() => {});
    return;
  }
  const wait = Math.min(delay, MAX_DELAY);
  const t = setTimeout(() => {
    if (wait < delay) scheduleGiveaway(client, guildId, messageId, endsAt);
    else endGiveawayNow(client, guildId, messageId).catch(() => {});
  }, wait);
  timers.set(messageId, t);
}

export async function reconcileGiveaways(client) {
  for (const { guildId, messageId, gw } of getAllGiveaways()) {
    if (gw.ended) continue;
    scheduleGiveaway(client, guildId, messageId, gw.endsAt);
  }
}

// --- Boutons Participer / Se désinscrire ---
export async function handleGiveawayInteraction(interaction) {
  if (!interaction.isButton()) return;
  const cid = interaction.customId;
  const guildId = interaction.guildId;

  if (cid === 'gw_join') {
    const messageId = interaction.message.id;
    const gw = getGiveaway(guildId, messageId);
    if (!gw || gw.ended) {
      return interaction.reply({ content: '❌ Ce giveaway est terminé.', ephemeral: true });
    }

    // Conditions d'inscription (statut / invitations).
    if (gw.requiredStatus && !statusText(interaction.member).includes(gw.requiredStatus.toLowerCase())) {
      return interaction.reply({
        content: `❌ Pour participer, tu dois avoir **\`${gw.requiredStatus}\`** dans ton statut, puis re-cliquer sur **Participer**.`,
        ephemeral: true,
      });
    }
    if (gw.requiredInvites) {
      const gained = invitesGained(gw, guildId, interaction.user.id);
      if (gained < gw.requiredInvites) {
        return interaction.reply({
          content: `❌ Il te faut **${gw.requiredInvites}** invitation(s) depuis le début du giveaway. Tu en as **${gained}**.`,
          ephemeral: true,
        });
      }
    }

    const leaveRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`gw_leave:${messageId}`).setLabel('Se désinscrire').setStyle(ButtonStyle.Danger),
    );

    const res = addGiveawayParticipant(guildId, messageId, interaction.user.id);

    // Info éligibilité.
    let extra = '';
    if (gw.requiredMessages) {
      const c = gw.messageCounts?.[interaction.user.id] ?? 0;
      const ok = c >= gw.requiredMessages;
      extra += `\n✉️ Messages : **${c}/${gw.requiredMessages}** ${ok ? '✅ éligible' : '— continue à écrire pour être éligible'}`;
    }
    if (gw.requiredInvites) {
      extra += `\n📨 Invitations : **${invitesGained(gw, guildId, interaction.user.id)}/${gw.requiredInvites}** ✅`;
    }

    if (res.already) {
      return interaction.reply({ content: `ℹ️ Tu participes déjà à ce giveaway.${extra}`, components: [leaveRow], ephemeral: true });
    }
    await interaction.reply({ content: `🎉 Vous vous êtes bien inscrit au giveaway !${extra}`, components: [leaveRow], ephemeral: true });
    await refreshParticipantCount(interaction.channel, guildId, messageId);
    return;
  }

  if (cid === 'gw_list') {
    const messageId = interaction.message.id;
    const gw = getGiveaway(guildId, messageId);
    if (!gw) return interaction.reply({ content: '❌ Giveaway introuvable.', ephemeral: true });
    const ids = gw.participants ?? [];
    if (!ids.length) return interaction.reply({ content: '👥 Aucun participant pour le moment.', ephemeral: true });

    const lines = ids.map((id, i) => `**${i + 1}.** <@${id}>`);
    let desc = lines.join('\n');
    let footer = null;
    if (desc.length > 4000) {
      // Tronque proprement pour rester sous la limite d'un embed.
      const kept = [];
      let len = 0;
      for (const line of lines) {
        if (len + line.length + 1 > 3900) break;
        kept.push(line);
        len += line.length + 1;
      }
      desc = kept.join('\n');
      footer = `… et ${ids.length - kept.length} autre(s)`;
    }

    const embed = new EmbedBuilder()
      .setColor(GW_COLOR)
      .setTitle(`👥 Participants — ${gw.prize}`)
      .setDescription(desc)
      .setFooter({ text: footer ?? `${ids.length} participant(s)` });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  }

  if (cid.startsWith('gw_leave:')) {
    const messageId = cid.slice('gw_leave:'.length);
    removeGiveawayParticipant(guildId, messageId, interaction.user.id);
    await interaction.update({ content: '✅ Tu t’es désinscrit du giveaway.', components: [] });
    await refreshParticipantCount(interaction.channel, guildId, messageId);
    return;
  }
}
