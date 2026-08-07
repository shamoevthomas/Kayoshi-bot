import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import {
  getGiveaway,
  updateGiveaway,
  addGiveawayParticipant,
  removeGiveawayParticipant,
  getAllGiveaways,
} from './store.js';

const GW_COLOR = 0xf47fff; // rose festif
const MAX_DELAY = 2_147_483_647; // limite de setTimeout (~24,8 j)
const timers = new Map(); // messageId -> timeout

function clearTimer(messageId) {
  const t = timers.get(messageId);
  if (t) clearTimeout(t);
  timers.delete(messageId);
}

// --- Rendu ---
export function buildJoinRow(disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('gw_join')
      .setEmoji('🎉')
      .setLabel('Participer')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
  );
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

  if (gw.requiredMessages) {
    embed.addFields({
      name: '✉️ Condition',
      value: `Avoir envoyé **${gw.requiredMessages}** message(s) depuis le début du giveaway pour être éligible.`,
      inline: false,
    });
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
  const gagner = plural ? 'Vous venez de gagner' : 'Tu viens de gagner';
  const votre = plural ? 'votre' : 'ton';
  const prefix = reroll ? '🔁 **Nouveau tirage !** ' : '';
  await channel
    .send({
      content: `${prefix}🎉 Bien joué ${mentions} ! ${gagner} **${gw.prize}**, crée un ticket pour recevoir ${votre} prix !`,
      allowedMentions: { users: winners },
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
        .edit({ embeds: [buildGiveawayEmbed({ ...gw, winnerIds: winners }, true)], components: [buildJoinRow(true)] })
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

    const leaveRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`gw_leave:${messageId}`).setLabel('Se désinscrire').setStyle(ButtonStyle.Danger),
    );

    const res = addGiveawayParticipant(guildId, messageId, interaction.user.id);

    // Info éligibilité (si condition de messages).
    let extra = '';
    if (gw.requiredMessages) {
      const c = gw.messageCounts?.[interaction.user.id] ?? 0;
      const ok = c >= gw.requiredMessages;
      extra = `\n✉️ Messages : **${c}/${gw.requiredMessages}** ${ok ? '✅ éligible' : '— continue à écrire pour être éligible'}`;
    }

    if (res.already) {
      return interaction.reply({ content: `ℹ️ Tu participes déjà à ce giveaway.${extra}`, components: [leaveRow], ephemeral: true });
    }
    return interaction.reply({ content: `🎉 Vous vous êtes bien inscrit au giveaway !${extra}`, components: [leaveRow], ephemeral: true });
  }

  if (cid.startsWith('gw_leave:')) {
    const messageId = cid.slice('gw_leave:'.length);
    removeGiveawayParticipant(guildId, messageId, interaction.user.id);
    return interaction.update({ content: '✅ Tu t’es désinscrit du giveaway.', components: [] });
  }
}
