import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getAvisConfig, getAvisReview, saveAvisReview } from './store.js';

const GOLD = 0xf1c40f;

function slug(s) {
  return String(s || 'ticket')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function ticketRef(review, number) {
  return `${slug(review?.motifLabel)}-${String(number).padStart(4, '0')}`;
}

function starsText(rating) {
  const n = Math.max(0, Math.min(5, rating || 0));
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

// Rangée des 5 boutons d'étoiles (met en avant la note actuelle).
export function ratingRow(guildId, number, current = 0) {
  const row = new ActionRowBuilder();
  for (let n = 1; n <= 5; n++) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`avis_rate:${guildId}:${number}:${n}`)
        .setLabel(String(n))
        .setEmoji('⭐')
        .setStyle(n === current ? ButtonStyle.Primary : ButtonStyle.Secondary),
    );
  }
  return row;
}

function commentRow(guildId, number, hasComment) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`avis_comment:${guildId}:${number}`)
      .setLabel(hasComment ? 'Modifier le commentaire' : 'Ajouter un commentaire')
      .setEmoji('💬')
      .setStyle(ButtonStyle.Secondary),
  );
}

// Embed « Merci pour ton avis ! » affiché dans le MP après une note.
function thanksEmbed(review, number) {
  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setTitle('⭐ Merci pour ton avis !')
    .setDescription(
      `Ta note pour le ticket **${ticketRef(review, number)}** : ${starsText(review.rating)}\n` +
        `Tu peux la modifier ou ajouter un commentaire.`,
    );
  if (review.comment) embed.addFields({ name: 'Ton commentaire', value: review.comment.slice(0, 1024) });
  return embed;
}

// Embed publié dans le salon des avis.
function reviewEmbed(review, number) {
  const embed = new EmbedBuilder()
    .setColor(GOLD)
    .setTitle('⭐ Avis sur un ticket')
    .addFields(
      { name: 'Ticket', value: `\`${ticketRef(review, number)}\``, inline: true },
      { name: 'Membre', value: `<@${review.userId}>`, inline: true },
      { name: 'Note', value: `${starsText(review.rating)} (${review.rating}/5)`, inline: true },
    )
    .setTimestamp();
  if (review.comment) embed.addFields({ name: 'Commentaire', value: review.comment.slice(0, 1024) });
  return embed;
}

// Poste (ou met à jour) l'avis dans le salon configuré.
async function postOrUpdateAvis(client, guildId, number) {
  const review = getAvisReview(guildId, number);
  const cfg = getAvisConfig(guildId);
  if (!review || !cfg?.channelId) return;
  const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) return;
  const channel = guild.channels.cache.get(cfg.channelId) ?? (await guild.channels.fetch(cfg.channelId).catch(() => null));
  if (!channel?.isTextBased()) return;

  const embed = reviewEmbed(review, number);
  if (review.messageId) {
    const msg = await channel.messages.fetch(review.messageId).catch(() => null);
    if (msg) {
      await msg.edit({ embeds: [embed] }).catch(() => {});
      return;
    }
  }
  const sent = await channel.send({ embeds: [embed] }).catch(() => null);
  if (sent) saveAvisReview(guildId, number, { messageId: sent.id });
}

// Routeur des interactions "avis_" (clics d'étoiles + commentaire, en MP).
export async function handleAvisInteraction(interaction) {
  const cid = interaction.customId ?? '';

  // Note (clic sur une étoile)
  if (cid.startsWith('avis_rate:')) {
    const [, guildId, number, n] = cid.split(':');
    const rating = Number(n);
    const review = saveAvisReview(guildId, number, { rating });
    await postOrUpdateAvis(interaction.client, guildId, number).catch(() => {});
    await interaction
      .update({
        embeds: [thanksEmbed(review, number)],
        components: [ratingRow(guildId, number, rating), commentRow(guildId, number, Boolean(review.comment))],
      })
      .catch(() => {});
    return;
  }

  // Ouvre le formulaire de commentaire
  if (cid.startsWith('avis_comment:')) {
    const [, guildId, number] = cid.split(':');
    const modal = new ModalBuilder()
      .setCustomId(`avis_commentmodal:${guildId}:${number}`)
      .setTitle('Ton commentaire')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('comment')
            .setLabel('Qu’as-tu pensé du support ?')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1000),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  // Soumission du commentaire
  if (cid.startsWith('avis_commentmodal:')) {
    const [, guildId, number] = cid.split(':');
    const comment = interaction.fields.getTextInputValue('comment');
    const review = saveAvisReview(guildId, number, { comment });
    await postOrUpdateAvis(interaction.client, guildId, number).catch(() => {});
    await interaction
      .update({
        embeds: [thanksEmbed(review, number)],
        components: [ratingRow(guildId, number, review.rating || 0), commentRow(guildId, number, true)],
      })
      .catch(() => {});
    return;
  }
}
