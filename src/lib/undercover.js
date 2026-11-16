import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, StringSelectMenuBuilder } from 'discord.js';
import { getCounting } from './store.js';
import { awardChatGameWin, chatGameReward, chatGameRunning } from './chatgames.js';
import { formatMoney } from './shop.js';

// Undercover (« +undercover ») : les civils ont tous le même mot, le ou les undercovers un mot proche, et personne
// ne connaît son rôle (« 🔍 Voir mon mot » le montre en privé). À chaque tour, chacun décrit son mot en un message
// sans le dire, puis les joueurs votent pour éliminer quelqu'un, dont le rôle est révélé. Les civils gagnent quand
// tous les undercovers sont éliminés ; les undercovers quand ils sont aussi nombreux que les civils encore en jeu
// (ou s'ils tiennent MAX_ROUNDS tours). L'équipe gagnante reçoit des coins et une victoire pour +jeux top.
// Une partie à la fois par salon, gardée en mémoire (perdue si le bot redémarre).

const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const LOBBY_MS = 5 * 60_000;
const TURN_MS = 60_000;
const VOTE_MS = 60_000;
const MAX_ROUNDS = 8;
const COLOR = 0x5865f2;

// Paires de mots proches : l'un des deux est tiré pour les civils, l'autre pour les undercovers.
const PAIRS = [
  ['Chat', 'Chien'], ['Café', 'Thé'], ['Plage', 'Piscine'], ['Pizza', 'Burger'], ['Pomme', 'Poire'], ['Guitare', 'Violon'],
  ['Football', 'Rugby'], ['Tennis', 'Badminton'], ['Avion', 'Hélicoptère'], ['Train', 'Métro'], ['Vélo', 'Trottinette'],
  ['Soleil', 'Lune'], ['Neige', 'Pluie'], ['Mer', 'Lac'], ['Lion', 'Tigre'], ['Loup', 'Renard'], ['Requin', 'Dauphin'],
  ['Abeille', 'Guêpe'], ['Papillon', 'Libellule'], ['Crocodile', 'Serpent'], ['Cheval', 'Âne'], ['Chocolat', 'Caramel'],
  ['Croissant', 'Pain au chocolat'], ['Glace', 'Sorbet'], ['Fraise', 'Framboise'], ['Citron', 'Orange'], ['Ketchup', 'Mayonnaise'],
  ['Sushi', 'Ramen'], ['Coca', 'Ice Tea'], ['Netflix', 'YouTube'], ['Instagram', 'TikTok'], ['Discord', 'WhatsApp'],
  ['iPhone', 'Samsung'], ['PlayStation', 'Xbox'], ['Mario', 'Luigi'], ['Naruto', 'Sasuke'], ['Goku', 'Vegeta'],
  ['Luffy', 'Zoro'], ['Minecraft', 'Roblox'], ['Fortnite', 'Valorant'], ['Pikachu', 'Évoli'], ['Vampire', 'Loup-garou'],
  ['Zombie', 'Fantôme'], ['Sorcière', 'Fée'], ['Pirate', 'Viking'], ['Ninja', 'Samouraï'], ['Roi', 'Prince'],
  ['Médecin', 'Infirmier'], ['Pompier', 'Policier'], ['Professeur', 'Élève'], ['Boulanger', 'Pâtissier'], ['École', 'Université'],
  ['Hôpital', 'Pharmacie'], ['Cinéma', 'Théâtre'], ['Concert', 'Festival'], ['Anniversaire', 'Mariage'], ['Noël', 'Halloween'],
  ['Été', 'Printemps'], ['Matin', 'Soir'], ['Lit', 'Canapé'], ['Oreiller', 'Couverture'], ['Douche', 'Bain'],
  ['Lunettes', 'Lentilles'], ['Montre', 'Bracelet'], ['Chapeau', 'Casquette'], ['Baskets', 'Bottes'], ['Jean', 'Jogging'],
  ['Parapluie', 'Imperméable'], ['Livre', 'Magazine'], ['Stylo', 'Crayon'], ['Ordinateur', 'Tablette'], ['Clavier', 'Souris'],
  ['Télé', 'Radio'], ['Photo', 'Vidéo'], ['Piano', 'Orgue'], ['Rap', 'Rock'], ['Ski', 'Snowboard'], ['Boxe', 'Karaté'],
  ['Château', 'Palais'], ['Paris', 'Londres'], ['Japon', 'Chine'], ['Désert', 'Savane'], ['Forêt', 'Jungle'],
  ['Étoile', 'Planète'], ['Fusée', 'Satellite'], ['Robot', 'Cyborg'], ['Dragon', 'Dinosaure'], ['Licorne', 'Pégase'],
  ['Bonbon', 'Chewing-gum'], ['Popcorn', 'Chips'], ['Steak', 'Poulet'], ['Frites', 'Purée'], ['Pâtes', 'Riz'],
  ['Miel', 'Confiture'], ['Lait', 'Yaourt'], ['Fromage', 'Beurre'], ['Jus de fruit', 'Smoothie'], ['Tornade', 'Tempête'],
  ['Volcan', 'Geyser'], ['Pyramide', 'Temple'], ['Valise', 'Sac à dos'], ['Bougie', 'Lampe'], ['Clé', 'Cadenas'],
];

const games = new Map(); // channelId → partie
export const undercoverRunning = (channelId) => games.has(channelId);

const quiet = { allowedMentions: { parse: [] } };
const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const shuffle = (list) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const undercoverCount = (n) => (n <= 5 ? 1 : n <= 9 ? 2 : 3);
const alive = (game) => game.players.filter((p) => p.alive);
const wordButton = () => new ButtonBuilder().setCustomId('uc:word').setLabel('Voir mon mot').setStyle(ButtonStyle.Primary).setEmoji('🔍');
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

function stop(game) {
  clearTimeout(game.timer);
  game.phase = 'done';
  games.delete(game.channelId);
}

// --- Salle d'attente ---

function lobbyPayload(game, note = '') {
  const list = game.players.map((p, i) => `${i + 1}. <@${p.id}>${p.id === game.hostId ? ' 👑' : ''}`).join('\n');
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle('🕵️ Undercover — en attente de joueurs')
    .setDescription(
      'Tout le monde reçoit un mot secret : les **civils** ont le même, le ou les **undercovers** un mot proche. ' +
        'Personne ne connaît son rôle !\nÀ chaque tour, décris ton mot en un message **sans le dire**, puis votez pour éliminer un suspect.\n\n' +
        `**Joueurs (${game.players.length}/${MAX_PLAYERS})**\n${list}` +
        (note ? `\n\n${note}` : ''),
    )
    .setFooter({ text: `De ${MIN_PLAYERS} à ${MAX_PLAYERS} joueurs · l’organisateur 👑 lance la partie` });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('uc:join').setLabel('Rejoindre').setStyle(ButtonStyle.Success).setEmoji('✅'),
    new ButtonBuilder().setCustomId('uc:leave').setLabel('Quitter').setStyle(ButtonStyle.Secondary).setEmoji('🚪'),
    new ButtonBuilder()
      .setCustomId('uc:start')
      .setLabel('Lancer')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('▶️')
      .setDisabled(game.players.length < MIN_PLAYERS),
    new ButtonBuilder().setCustomId('uc:cancel').setLabel('Annuler').setStyle(ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row], ...quiet };
}

async function openLobby(message) {
  const { channel, guild, author } = message;
  const reply = (content) => message.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
  if (getCounting(guild.id)?.channelId === channel.id) return reply('❌ Pas de jeu dans le salon du compteur.');
  const running = games.get(channel.id);
  if (running) return reply(`❌ Une partie d’Undercover est déjà en cours ici${running.message ? ` : ${running.message.url}` : ''}.`);
  if (chatGameRunning(channel.id)) return reply('❌ Un autre jeu est en cours dans ce salon : attends qu’il se termine.');

  const game = { channelId: channel.id, guildId: guild.id, channel, hostId: author.id, phase: 'lobby', players: [{ id: author.id, alive: true }] };
  games.set(channel.id, game);
  game.message = await channel.send(lobbyPayload(game)).catch(() => null);
  if (!game.message) return stop(game);
  game.timer = setTimeout(() => {
    if (game.phase !== 'lobby') return;
    stop(game);
    game.message.edit({ ...lobbyPayload(game, '⌛ Partie annulée : personne ne l’a lancée à temps.'), components: [] }).catch(() => {});
  }, LOBBY_MS);
}

// --- Partie ---

async function launch(game) {
  clearTimeout(game.timer);
  const [a, b] = shuffle(PAIRS[Math.floor(Math.random() * PAIRS.length)]);
  game.words = { civil: a, undercover: b };
  const spies = new Set(shuffle(game.players.map((p) => p.id)).slice(0, undercoverCount(game.players.length)));
  for (const p of game.players) {
    p.role = spies.has(p.id) ? 'undercover' : 'civil';
    p.word = game.words[p.role];
  }
  game.round = 0;
  // Chaque mot part en MP ; ceux qui ont fermé leurs MP le voient avec « 🔍 Voir mon mot ».
  const closed = [];
  for (const p of game.players) {
    const sent = await game.channel.client.users
      .send(p.id, `🕵️ **Undercover** dans ${game.channel} : ton mot secret est **${p.word}**.\n-# Décris-le sans le dire quand ce sera ton tour. Bonne chance !`)
      .then(() => true)
      .catch(() => false);
    if (!sent) closed.push(p.id);
  }
  await game.message
    .edit({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR)
          .setTitle('🕵️ Undercover — la partie commence !')
          .setDescription(
            `**${plural(game.players.length, 'joueur')}**, dont **${plural(spies.size, 'undercover')}** caché${spies.size > 1 ? 's' : ''} parmi vous.\n` +
              '📩 Ton mot secret t’a été envoyé **en MP**.' +
              (closed.length
                ? `\n⚠️ MP fermés : ${closed.map((id) => `<@${id}>`).join(' ')} — cliquez sur **🔍 Voir mon mot** (vous seuls le voyez).`
                : '\n-# MP perdu ? **🔍 Voir mon mot** le remontre (toi seul le vois).') +
              `\n\n${game.players.map((p) => `<@${p.id}>`).join(' ')}`,
          ),
      ],
      components: [new ActionRowBuilder().addComponents(wordButton())],
      ...quiet,
    })
    .catch(() => {});
  setTimeout(() => newRound(game), 8000); // le temps de lire son mot
}

async function newRound(game) {
  if (game.phase === 'done') return;
  game.round += 1;
  game.phase = 'describe';
  game.order = shuffle(alive(game).map((p) => p.id));
  game.turn = -1;
  await game.channel
    .send({ content: `🎙️ **Tour ${game.round}** — chacun décrit son mot en **un message**, sans le dire. Ordre : ${game.order.map((id) => `<@${id}>`).join(' → ')}`, ...quiet })
    .catch(() => {});
  return nextTurn(game);
}

async function nextTurn(game) {
  clearTimeout(game.timer);
  game.turn += 1;
  if (game.turn >= game.order.length) return openVote(game);
  const id = game.order[game.turn];
  await game.channel
    .send({
      content: `👉 <@${id}>, à toi : décris ton mot en un message (${TURN_MS / 1000} s).`,
      components: [new ActionRowBuilder().addComponents(wordButton())],
      allowedMentions: { users: [id] },
    })
    .catch(() => {});
  game.timer = setTimeout(async () => {
    if (game.phase !== 'describe' || game.order[game.turn] !== id) return;
    await game.channel.send({ content: `⏭️ <@${id}> n’a rien dit : au suivant.`, ...quiet }).catch(() => {});
    nextTurn(game);
  }, TURN_MS);
}

function votePayload(game, closed = false) {
  const voters = alive(game);
  const done = voters.filter((p) => game.votes.has(p.id)).length;
  const select = new StringSelectMenuBuilder()
    .setCustomId('uc:vote')
    .setPlaceholder('🗳️ Qui est l’undercover ?')
    .setDisabled(closed)
    .addOptions(voters.map((p) => ({ label: (game.names.get(p.id) ?? p.id).slice(0, 100), value: p.id })));
  return {
    content: `🗳️ **Vote du tour ${game.round}** — qui est l’undercover ? (${done}/${voters.length} ont voté${closed ? '' : `, ${VOTE_MS / 1000} s`})`,
    components: [new ActionRowBuilder().addComponents(select), new ActionRowBuilder().addComponents(wordButton())],
    ...quiet,
  };
}

async function openVote(game) {
  clearTimeout(game.timer);
  game.phase = 'vote';
  game.votes = new Map();
  game.voteMessage = await game.channel.send(votePayload(game)).catch(() => null);
  game.timer = setTimeout(() => closeVote(game), VOTE_MS);
}

async function closeVote(game) {
  if (game.phase !== 'vote') return;
  clearTimeout(game.timer);
  game.phase = 'reveal';
  await game.voteMessage?.edit(votePayload(game, true)).catch(() => {});
  const tally = new Map();
  for (const target of game.votes.values()) tally.set(target, (tally.get(target) ?? 0) + 1);
  const best = Math.max(0, ...tally.values());
  const top = [...tally].filter(([, n]) => n === best).map(([id]) => id);
  if (!best || top.length > 1) {
    await game.channel.send({ content: `⚖️ ${best ? 'Égalité' : 'Personne n’a voté'} : personne n’est éliminé ce tour-ci.`, ...quiet }).catch(() => {});
  } else {
    const out = game.players.find((p) => p.id === top[0]);
    out.alive = false;
    await game.channel
      .send({
        content:
          `☠️ <@${out.id}> est éliminé avec **${best} voix**… ` +
          (out.role === 'undercover' ? `C’était un **undercover** 🕵️ (son mot : **${out.word}**) !` : `C’était un **civil** 😇.`),
        ...quiet,
      })
      .catch(() => {});
  }
  const spies = alive(game).filter((p) => p.role === 'undercover').length;
  const civils = alive(game).length - spies;
  if (!spies) return finish(game, 'civil');
  if (spies >= civils || game.round >= MAX_ROUNDS) return finish(game, 'undercover');
  game.timer = setTimeout(() => newRound(game), 4000);
}

async function finish(game, winner) {
  stop(game);
  const winners = game.players.filter((p) => p.role === winner);
  const paid = winners.filter((p) => awardChatGameWin(game.guildId, p.id, 'undercover'));
  const roles = game.players
    .map((p) => `${p.role === 'undercover' ? '🕵️' : '😇'} <@${p.id}> — ${p.role === 'undercover' ? 'undercover' : 'civil'}${p.alive ? '' : ' ☠️'}`)
    .join('\n');
  const embed = new EmbedBuilder()
    .setColor(winner === 'civil' ? 0x57f287 : 0xed4245)
    .setTitle(winner === 'civil' ? '😇 Les civils gagnent !' : '🕵️ Les undercovers gagnent !')
    .setDescription(
      `Mot des civils : **${game.words.civil}** · mot des undercovers : **${game.words.undercover}**\n\n${roles}` +
        (paid.length ? `\n\n🪙 **+${formatMoney(chatGameReward('undercover'))}** coins pour ${paid.map((p) => `<@${p.id}>`).join(', ')}` : ''),
    )
    .setFooter({ text: 'Rejoue avec +undercover · classement : +jeux top undercover' });
  await game.channel.send({ embeds: [embed], ...quiet }).catch(() => {});
}

// --- Messages : « +undercover », et la description du joueur dont c'est le tour ---

export async function handleUndercoverMessage(message) {
  if (!message.guild || message.author.bot) return false;
  const text = message.content.trim();
  if (/^\+undercover$/i.test(text)) {
    await openLobby(message);
    return true;
  }
  const game = games.get(message.channelId);
  if (game?.phase !== 'describe' || game.order[game.turn] !== message.author.id || !text) return false;
  const player = game.players.find((p) => p.id === message.author.id);
  if (normalize(text).includes(normalize(player.word))) {
    await message.reply({ content: '🤫 Tu ne peux pas dire ton mot ! Décris-le autrement.', allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
    return true;
  }
  await message.react('✅').catch(() => {});
  nextTurn(game);
  return true;
}

// --- Boutons et vote « uc:… » ---

export async function handleUndercoverInteraction(interaction) {
  const game = games.get(interaction.channelId);
  const action = interaction.customId.slice('uc:'.length);
  const ephemeral = (content) => interaction.reply({ content, ephemeral: true });
  if (!game) return ephemeral('⌛ Cette partie est terminée. Lance-en une avec `+undercover`.');
  const player = game.players.find((p) => p.id === interaction.user.id);

  if (action === 'word') {
    if (!player || !player.word) return ephemeral('ℹ️ Tu ne joues pas dans cette partie.');
    return ephemeral(`🤫 Ton mot : **${player.word}**${player.alive ? '' : ' (tu es éliminé)'}`);
  }

  if (action === 'vote') {
    if (game.phase !== 'vote' || interaction.message.id !== game.voteMessage?.id) return ephemeral('⌛ Ce vote est terminé.');
    if (!player?.alive) return ephemeral('ℹ️ Seuls les joueurs encore en jeu votent.');
    const target = interaction.values[0];
    if (target === player.id) return ephemeral('❌ Tu ne peux pas voter contre toi.');
    game.votes.set(player.id, target);
    await interaction.update(votePayload(game)).catch(() => {});
    if (game.votes.size === alive(game).length) closeVote(game);
    return;
  }

  // Salle d'attente.
  if (game.phase !== 'lobby' || interaction.message.id !== game.message.id) return ephemeral('⌛ La partie a déjà commencé.');
  const isHost = interaction.user.id === game.hostId;
  if (action === 'join') {
    if (player) return ephemeral('ℹ️ Tu es déjà inscrit.');
    if (game.players.length >= MAX_PLAYERS) return ephemeral(`❌ La partie est complète (${MAX_PLAYERS} joueurs).`);
    game.players.push({ id: interaction.user.id, alive: true });
    return interaction.update(lobbyPayload(game));
  }
  if (action === 'leave') {
    if (!player) return ephemeral('ℹ️ Tu n’es pas inscrit.');
    game.players = game.players.filter((p) => p.id !== interaction.user.id);
    if (!game.players.length) {
      stop(game);
      return interaction.update({ ...lobbyPayload(game, '🚪 Plus personne : partie annulée.'), components: [] });
    }
    if (isHost) game.hostId = game.players[0].id; // l'organisateur part : le suivant le remplace
    return interaction.update(lobbyPayload(game));
  }
  if (action === 'cancel') {
    if (!isHost && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) return ephemeral('❌ Seul l’organisateur 👑 peut annuler.');
    stop(game);
    return interaction.update({ ...lobbyPayload(game, '✖️ Partie annulée.'), components: [] });
  }
  if (action === 'start') {
    if (!isHost) return ephemeral('❌ Seul l’organisateur 👑 peut lancer la partie.');
    if (game.players.length < MIN_PLAYERS) return ephemeral(`❌ Il faut au moins ${MIN_PLAYERS} joueurs.`);
    // Pseudos pour le menu de vote.
    game.names = new Map();
    for (const p of game.players) {
      const member = await interaction.guild.members.fetch(p.id).catch(() => null);
      game.names.set(p.id, member?.displayName ?? p.id);
    }
    game.phase = 'starting';
    await interaction.deferUpdate();
    return launch(game);
  }
}
