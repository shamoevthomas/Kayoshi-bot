import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getWyr, saveWyr, deleteWyr, getAllWyr } from './store.js';

// « Tu préfères… » (/tu-preferes) : un dilemme au hasard, deux boutons pour voter (un vote par
// personne), puis les pourcentages à la fin du temps. Les votes sont gardés en base : un
// redémarrage du bot ne coupe pas le vote.

export const QUESTIONS = [
  ['Être un chien', 'Être un chat'],
  ['Pouvoir voler', 'Être invisible'],
  ['Voyager dans le passé', 'Voyager dans le futur'],
  ['Parler toutes les langues', 'Parler aux animaux'],
  ['Lire dans les pensées', 'Voir l’avenir'],
  ['Vivre à la mer', 'Vivre à la montagne'],
  ['Avoir toujours trop chaud', 'Avoir toujours trop froid'],
  ['Ne plus jamais manger de pizza', 'Ne plus jamais manger de burger'],
  ['Vivre sans musique', 'Vivre sans films ni séries'],
  ['Ne plus jamais avoir internet', 'Ne plus jamais avoir de téléphone'],
  ['Être super riche', 'Être super célèbre'],
  ['Avoir un dragon de compagnie', 'Être un dragon'],
  ['Vivre dans un jeu vidéo', 'Vivre dans un dessin animé'],
  ['Pouvoir te téléporter', 'Pouvoir arrêter le temps'],
  ['Ne plus jamais dormir', 'Ne plus jamais avoir faim'],
  ['Être le plus intelligent du monde', 'Être le plus drôle du monde'],
  ['Habiter dans un château', 'Habiter dans une cabane dans les arbres'],
  ['Avoir une mémoire parfaite', 'Pouvoir oublier ce que tu veux'],
  ['Ne manger que du sucré', 'Ne manger que du salé'],
  ['Vivre 1000 ans', 'Vivre 10 vies de 100 ans'],
  ['Explorer l’espace', 'Explorer le fond des océans'],
  ['Avoir des ailes', 'Avoir des branchies'],
  ['Être un super-héros', 'Être un super-méchant'],
  ['Gagner au loto', 'Trouver l’amour de ta vie'],
  ['Ne plus jamais jouer aux jeux vidéo', 'Ne plus jamais regarder de vidéos'],
  ['Être toujours en retard', 'Être toujours 2 heures en avance'],
  ['Parler comme un robot', 'Parler comme un pirate'],
  ['Avoir un bouton pause pour ta vie', 'Avoir un bouton retour en arrière'],
  ['Vivre sans réseaux sociaux', 'Vivre sans plats préparés'],
  ['Être un sorcier', 'Être un vampire'],
  ['Vivre en ville', 'Vivre à la campagne'],
  ['Courir aussi vite qu’une voiture', 'Sauter aussi haut qu’un immeuble'],
  ['Ne plus jamais avoir froid', 'Ne plus jamais être fatigué'],
  ['Connaître la date de ta mort', 'Connaître la cause de ta mort'],
  ['Avoir un chef cuisinier à domicile', 'Avoir un chauffeur personnel'],
  ['Être youtubeur', 'Être streamer'],
  ['Faire le tour du monde en bateau', 'Faire le tour du monde en avion'],
  ['Parler à ton toi d’il y a 10 ans', 'Parler à ton toi dans 10 ans'],
  ['Avoir une maison sans wifi', 'Avoir une maison sans eau chaude'],
  ['Ne manger que des pâtes', 'Ne manger que du riz'],
  ['Être un ninja', 'Être un samouraï'],
  ['Vivre l’été toute l’année', 'Vivre l’hiver toute l’année'],
  ['Avoir 10 frères et sœurs', 'Être enfant unique'],
  ['Pouvoir respirer sous l’eau', 'Pouvoir voir dans le noir'],
  ['Regarder uniquement des films d’horreur', 'Regarder uniquement des comédies romantiques'],
  ['Être un génie de la musique', 'Être un génie du sport'],
  ['Avoir un robot qui fait le ménage', 'Avoir un robot qui fait tes devoirs'],
  ['Être la personne la plus forte du monde', 'Être la personne la plus rapide du monde'],
  ['Visiter Mars', 'Visiter la Lune'],
  ['Pouvoir changer d’apparence à volonté', 'Pouvoir changer de voix à volonté'],
];

export const MIN_DURATION = 10_000;
export const MAX_DURATION = 7 * 86_400_000;

const pick = () => QUESTIONS[Math.floor(Math.random() * QUESTIONS.length)];
const unix = (ms) => Math.floor(ms / 1000);
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

function voteEmbed(poll) {
  const voters = Object.keys(poll.votes).length;
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🤔 Tu préfères…')
    .setDescription(
      `🅰️ **${poll.a}**\n\n*ou*\n\n🅱️ **${poll.b}**\n\n` +
        `⏳ Fin du vote <t:${unix(poll.endsAt)}:R>\n🗳️ **${plural(voters, 'votant')}**`,
    )
    .setFooter({ text: 'Un seul vote par personne' });
}

function voteButtons(poll, results = null) {
  const label = (side) => (results ? `Option ${side.toUpperCase()} — ${results[side]} %` : `Option ${side.toUpperCase()}`);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('tp_vote:a').setLabel(label('a')).setStyle(ButtonStyle.Primary).setEmoji('🅰️').setDisabled(Boolean(results)),
    new ButtonBuilder().setCustomId('tp_vote:b').setLabel(label('b')).setStyle(ButtonStyle.Danger).setEmoji('🅱️').setDisabled(Boolean(results)),
  );
}

// Pourcentages (dont la somme fait 100) et nombre de votes de chaque côté.
function results(poll) {
  const votes = Object.values(poll.votes);
  const a = votes.filter((v) => v === 'a').length;
  const b = votes.length - a;
  const pa = votes.length ? Math.round((a * 100) / votes.length) : 0;
  return { a: pa, b: votes.length ? 100 - pa : 0, countA: a, countB: b, total: votes.length };
}

const bar = (percent, color) => `${color.repeat(Math.round(percent / 10))}${'⬜'.repeat(10 - Math.round(percent / 10))}`;

function resultEmbed(poll, r) {
  const winner = r.total && r.countA !== r.countB ? (r.countA > r.countB ? 'a' : 'b') : null;
  const line = (side, emoji, text, color) =>
    `${emoji} **${text}**${winner === side ? ' 🏆' : ''}\n${bar(r[side], color)} **${r[side]} %** (${plural(side === 'a' ? r.countA : r.countB, 'vote')})`;
  return new EmbedBuilder()
    .setColor(0xf0b232)
    .setTitle('🤔 Tu préfères… — résultats')
    .setDescription(
      r.total
        ? `${line('a', '🅰️', poll.a, '🟦')}\n\n${line('b', '🅱️', poll.b, '🟥')}\n\n👥 **${plural(r.total, 'votant')}** · terminé <t:${unix(poll.endsAt)}:R>`
        : `🅰️ **${poll.a}**\n*ou*\n🅱️ **${poll.b}**\n\nPersonne n’a voté 😢`,
    );
}

// --- Fin du vote ---

const timers = new Map();
const MAX_DELAY = 2_147_000_000; // limite de setTimeout (~24,8 jours)

async function endPoll(client, guildId, messageId) {
  timers.delete(messageId);
  const poll = getWyr(guildId, messageId);
  if (!poll) return;
  deleteWyr(guildId, messageId);
  const channel = await client.channels.fetch(poll.channelId).catch(() => null);
  const message = await channel?.messages.fetch(messageId).catch(() => null);
  if (!message) return;
  const r = results(poll);
  await message.edit({ embeds: [resultEmbed(poll, r)], components: [voteButtons(poll, r)] }).catch(() => {});
  await message
    .reply({
      content: r.total
        ? `⏰ Fin du vote ! 🅰️ **${poll.a}** ${r.a} % — 🅱️ **${poll.b}** ${r.b} % · ${plural(r.total, 'votant')}`
        : '⏰ Fin du vote ! Personne n’a voté.',
      allowedMentions: { repliedUser: false },
    })
    .catch(() => {});
}

function schedule(client, guildId, messageId, endsAt) {
  clearTimeout(timers.get(messageId));
  const delay = endsAt - Date.now();
  if (delay <= 0) {
    endPoll(client, guildId, messageId).catch((err) => console.error('[tu-preferes]', err));
    return;
  }
  const wait = Math.min(delay, MAX_DELAY);
  timers.set(
    messageId,
    setTimeout(() => {
      if (wait < delay) schedule(client, guildId, messageId, endsAt);
      else endPoll(client, guildId, messageId).catch((err) => console.error('[tu-preferes]', err));
    }, wait),
  );
}

// Au démarrage : reprogramme la fin des votes en cours (ou les termine s'ils ont expiré).
export function reconcileWouldYouRather(client) {
  for (const { guildId, messageId, poll } of getAllWyr()) schedule(client, guildId, messageId, poll.endsAt);
}

// Lance un vote dans le salon de l'interaction. Renvoie le message envoyé.
export async function startPoll(interaction, durationMs) {
  const [a, b] = pick();
  const poll = { channelId: interaction.channelId, a, b, endsAt: Date.now() + durationMs, votes: {} };
  const message = await interaction.reply({ embeds: [voteEmbed(poll)], components: [voteButtons(poll)], fetchReply: true });
  saveWyr(interaction.guildId, message.id, poll);
  schedule(interaction.client, interaction.guildId, message.id, poll.endsAt);
  return message;
}

// --- Votes (boutons « tp_vote:a » / « tp_vote:b ») ---

// Le nombre de votants dans l'embed est mis à jour au plus toutes les 5 s (limite de Discord).
const pendingRefresh = new Set();
function refreshCount(message, guildId) {
  if (pendingRefresh.has(message.id)) return;
  pendingRefresh.add(message.id);
  setTimeout(() => {
    pendingRefresh.delete(message.id);
    const poll = getWyr(guildId, message.id);
    if (poll) message.edit({ embeds: [voteEmbed(poll)] }).catch(() => {});
  }, 5000);
}

export async function handleWouldYouRatherInteraction(interaction) {
  if (!interaction.isButton()) return;
  const side = interaction.customId.split(':')[1];
  const poll = getWyr(interaction.guildId, interaction.message.id);
  if (!poll || Date.now() >= poll.endsAt) {
    return interaction.reply({ content: '❌ Ce vote est terminé.', ephemeral: true });
  }
  const previous = poll.votes[interaction.user.id];
  if (previous) {
    return interaction.reply({
      content: `❌ Tu as déjà voté pour l’option ${previous.toUpperCase()} : **${poll[previous]}**.`,
      ephemeral: true,
    });
  }
  poll.votes[interaction.user.id] = side;
  saveWyr(interaction.guildId, interaction.message.id, poll);
  refreshCount(interaction.message, interaction.guildId);
  return interaction.reply({ content: `✅ Vote enregistré pour l’option ${side.toUpperCase()} : **${poll[side]}**.`, ephemeral: true });
}
