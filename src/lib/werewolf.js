import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, StringSelectMenuBuilder } from 'discord.js';
import { getCounting } from './store.js';
import { awardChatGameWin, chatGameReward, chatGameRunning } from './chatgames.js';
import { undercoverRunning } from './undercover.js';
import { formatMoney } from './shop.js';
import { mutePlayers, unmuteAll } from './gamemute.js';

// Loup-garou (« +lp ») : de 5 à 16 joueurs, rôles envoyés en MP (et « 🔍 Mon rôle » pour les MP fermés).
// Nuit : tout le monde clique sur « 🌙 Agir » (personne ne se trahit) ; les loups choisissent une victime, la voyante
// découvre un rôle, les autres dorment. Puis la sorcière se réveille (potion de vie pour la victime, potion de mort,
// une fois chacune). Jour : les morts sont annoncés avec leur rôle, débat, vote pour éliminer un suspect (égalité :
// personne). Le chasseur qui meurt emporte quelqu'un. Cupidon (dès 6 joueurs) lie deux amoureux la première nuit :
// si l'un meurt, l'autre meurt de chagrin ; un couple loup + village gagne seulement s'il reste seul en vie.
// Le village gagne quand tous les loups sont morts, les loups
// quand ils sont aussi nombreux que les autres. Les gagnants reçoivent des coins (+jeux top). Une partie par salon.
// La nuit (loups, voyante, sorcière), les joueurs ne peuvent plus écrire dans le salon (lib/gamemute.js) ; les autres
// membres, si. La parole revient au lever du jour.

const MIN_PLAYERS = 5;
const MAX_PLAYERS = 16;
const LOBBY_MS = 5 * 60_000;
const NIGHT_MS = 60_000;
const WITCH_MS = 30_000;
const HUNTER_MS = 30_000;
const DEBATE_MS = 90_000;
const VOTE_MS = 60_000;
const NIGHT_COLOR = 0x2c2f6b;
const DAY_COLOR = 0xf5b041;

const ROLES = {
  loup: { name: 'Loup-garou', plural: 'loups-garous', emoji: '🐺', team: 'loups', about: 'Chaque nuit, avec la meute, choisis une victime. Le jour, fais-toi passer pour un villageois.' },
  voyante: { name: 'Voyante', plural: 'voyantes', emoji: '🔮', team: 'village', about: 'Chaque nuit, découvre le rôle d’un joueur.' },
  sorciere: { name: 'Sorcière', plural: 'sorcières', emoji: '🧪', team: 'village', about: 'Une potion de vie (sauver la victime des loups) et une potion de mort (éliminer un joueur), une fois chacune.' },
  chasseur: { name: 'Chasseur', plural: 'chasseurs', emoji: '🔫', team: 'village', about: 'Quand tu meurs, tu emportes un joueur avec toi.' },
  cupidon: {
    name: 'Cupidon',
    plural: 'cupidons',
    emoji: '💘',
    team: 'village',
    about: 'La première nuit, désigne deux amoureux (toi compris si tu veux) : si l’un meurt, l’autre meurt de chagrin.',
  },
  villageois: { name: 'Villageois', plural: 'villageois', emoji: '🧑‍🌾', team: 'village', about: 'Trouve les loups-garous et vote contre eux le jour.' },
};

const games = new Map(); // channelId → partie
export const werewolfRunning = (channelId) => games.has(channelId);

const quiet = { allowedMentions: { parse: [] } };
const shuffle = (list) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const alive = (game) => game.players.filter((p) => p.alive);
const player = (game, id) => game.players.find((p) => p.id === id);
const roleText = (p) => `${ROLES[p.role].emoji} **${ROLES[p.role].name}**`;
const name = (game, id) => (game.names.get(id) ?? id).slice(0, 100);
const button = (id, label, style, emoji) => {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  return emoji ? b.setEmoji(emoji) : b;
};
const roleButton = () => button('lg:role', 'Mon rôle', ButtonStyle.Secondary, '🔍');
// Les amoureux de Cupidon : [joueur, joueur] ou [] ; « mixte » quand ils ne sont pas du même camp.
const lovers = (game) => (game.lovers ?? []).map((id) => player(game, id));
const mixedLovers = (game) => {
  const [a, b] = lovers(game);
  return Boolean(a && b && ROLES[a.role].team !== ROLES[b.role].team);
};
const partnerOf = (game, id) => (game.lovers?.includes(id) ? player(game, game.lovers.find((l) => l !== id)) : null);
// Morts de chagrin (amoureux) parmi les morts, en lignes à ajouter à l'annonce.
const griefLines = (dead) => dead.filter((p) => p.grief).map((p) => `💔 <@${p.id}> meurt de chagrin… C’était ${roleText(p)}.`);

// Composition selon le nombre de joueurs.
function composition(n) {
  const wolves = n >= 16 ? 4 : n >= 12 ? 3 : n >= 8 ? 2 : 1;
  const roles = Array(wolves).fill('loup');
  roles.push('voyante');
  if (n >= 6) roles.push('sorciere');
  if (n >= 7) roles.push('chasseur');
  if (n >= 6) roles.push('cupidon');
  while (roles.length < n) roles.push('villageois');
  return roles;
}

function stop(game) {
  clearTimeout(game.timer);
  game.phase = 'done';
  games.delete(game.channelId);
  if (game.channel) unmuteAll(game.channel, 'Loup-garou terminé').catch(() => {});
}

// --- Salle d'attente ---

function lobbyPayload(game, note = '') {
  const list = game.players.map((p, i) => `${i + 1}. <@${p.id}>${p.id === game.hostId ? ' 👑' : ''}`).join('\n');
  const embed = new EmbedBuilder()
    .setColor(NIGHT_COLOR)
    .setTitle('🐺 Loup-garou — en attente de joueurs')
    .setDescription(
      'Des loups-garous se cachent parmi les villageois. La nuit, ils dévorent quelqu’un ; le jour, le village vote pour ' +
        'éliminer un suspect. Rôles : 🐺 loups, 🔮 voyante, 🧪 sorcière, 🔫 chasseur, 🧑‍🌾 villageois.\n\n' +
        `**Joueurs (${game.players.length}/${MAX_PLAYERS})**\n${list}` +
        (note ? `\n\n${note}` : ''),
    )
    .setFooter({ text: `De ${MIN_PLAYERS} à ${MAX_PLAYERS} joueurs · l’organisateur 👑 lance la partie` });
  const row = new ActionRowBuilder().addComponents(
    button('lg:join', 'Rejoindre', ButtonStyle.Success, '✅'),
    button('lg:leave', 'Quitter', ButtonStyle.Secondary, '🚪'),
    button('lg:start', 'Lancer', ButtonStyle.Primary, '▶️').setDisabled(game.players.length < MIN_PLAYERS),
    button('lg:cancel', 'Annuler', ButtonStyle.Danger),
  );
  return { embeds: [embed], components: [row], ...quiet };
}

async function openLobby(message) {
  const { channel, guild, author } = message;
  const reply = (content) => message.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
  if (getCounting(guild.id)?.channelId === channel.id) return reply('❌ Pas de jeu dans le salon du compteur.');
  if (games.has(channel.id)) return reply('❌ Une partie de loup-garou est déjà en cours dans ce salon.');
  if (chatGameRunning(channel.id) || undercoverRunning(channel.id)) return reply('❌ Un autre jeu est en cours dans ce salon : attends qu’il se termine.');

  const game = { channelId: channel.id, guildId: guild.id, channel, hostId: author.id, phase: 'lobby', players: [{ id: author.id, alive: true }], names: new Map() };
  games.set(channel.id, game);
  game.message = await channel.send(lobbyPayload(game)).catch(() => null);
  if (!game.message) return stop(game);
  game.timer = setTimeout(() => {
    if (game.phase !== 'lobby') return;
    stop(game);
    game.message.edit({ ...lobbyPayload(game, '⌛ Partie annulée : personne ne l’a lancée à temps.'), components: [] }).catch(() => {});
  }, LOBBY_MS);
}

// --- Début de partie ---

async function launch(game) {
  clearTimeout(game.timer);
  const roles = shuffle(composition(game.players.length));
  game.players.forEach((p, i) => Object.assign(p, { role: roles[i], alive: true }));
  game.night = 0;
  game.witch = { heal: true, poison: true };
  const wolves = game.players.filter((p) => p.role === 'loup');
  const closed = [];
  for (const p of game.players) {
    const role = ROLES[p.role];
    const pack = p.role === 'loup' && wolves.length > 1 ? `\nTa meute : ${wolves.filter((w) => w.id !== p.id).map((w) => `**${name(game, w.id)}**`).join(', ')}.` : '';
    const sent = await game.channel.client.users
      .send(p.id, `🐺 **Loup-garou** dans ${game.channel} : tu es ${role.emoji} **${role.name}** !\n${role.about}${pack}`)
      .then(() => true)
      .catch(() => false);
    if (!sent) closed.push(p.id);
  }
  const counts = Object.entries(roles.reduce((acc, r) => ({ ...acc, [r]: (acc[r] ?? 0) + 1 }), {}))
    .map(([r, n]) => `${ROLES[r].emoji} ${n} ${n > 1 ? ROLES[r].plural : ROLES[r].name.toLowerCase()}`)
    .join(' · ');
  await game.message
    .edit({
      embeds: [
        new EmbedBuilder()
          .setColor(NIGHT_COLOR)
          .setTitle('🐺 Loup-garou — la partie commence !')
          .setDescription(
            `**${game.players.length} joueurs** : ${counts}.\n📩 Ton rôle t’a été envoyé **en MP**.` +
              (closed.length ? `\n⚠️ MP fermés : ${closed.map((id) => `<@${id}>`).join(' ')} — cliquez sur **🔍 Mon rôle**.` : '') +
              '\n-# Les morts ne parlent plus de la partie. La première nuit tombe dans quelques secondes…',
          ),
      ],
      components: [new ActionRowBuilder().addComponents(roleButton())],
      ...quiet,
    })
    .catch(() => {});
  game.timer = setTimeout(() => startNight(game), 10_000);
}

// --- Nuit : loups et voyante, puis sorcière ---

async function startNight(game) {
  if (game.phase === 'done') return;
  clearTimeout(game.timer);
  Object.assign(game, { phase: 'night', wolfVotes: new Map(), victim: null, poisoned: null, saved: false });
  game.night += 1;
  game.cupidDone = game.night > 1 || !alive(game).some((p) => p.role === 'cupidon');
  // Le village dort : les joueurs ne peuvent plus écrire jusqu'au jour.
  mutePlayers(game.channel, game.players.map((p) => p.id), 'Loup-garou : le village dort').catch(() => {});
  game.seerDone = !alive(game).some((p) => p.role === 'voyante');
  await game.channel
    .send({
      embeds: [
        new EmbedBuilder()
          .setColor(NIGHT_COLOR)
          .setTitle(`🌙 Nuit ${game.night}`)
          .setDescription(
            'Le village s’endort… **Tout le monde clique sur 🌙 Agir** (pour ne pas se trahir) : les loups choisissent leur victime, ' +
              `la voyante découvre un rôle${game.cupidDone ? '' : ', Cupidon désigne deux amoureux'}, les autres dorment. (${NIGHT_MS / 1000} s)`,
          ),
      ],
      components: [new ActionRowBuilder().addComponents(button('lg:act', 'Agir', ButtonStyle.Primary, '🌙'), roleButton())],
      ...quiet,
    })
    .catch(() => {});
  game.timer = setTimeout(() => endWolves(game), NIGHT_MS);
}

function wolfPanel(game, wolf, note = '') {
  const targets = alive(game).filter((p) => p.role !== 'loup');
  const votes = [...game.wolfVotes].map(([w, t]) => `• ${name(game, w)} → **${name(game, t)}**`).join('\n') || '_Personne n’a encore voté._';
  return {
    content: `${note ? `${note}\n\n` : ''}🐺 **Choisis la victime de la meute.**\nVotes de la meute :\n${votes}`,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('lg:wolf')
          .setPlaceholder('Victime…')
          .addOptions(targets.map((p) => ({ label: name(game, p.id), value: p.id, default: game.wolfVotes.get(wolf.id) === p.id }))),
      ),
    ],
  };
}

function checkNightDone(game) {
  const wolves = alive(game).filter((p) => p.role === 'loup');
  if (game.phase === 'night' && game.seerDone && game.cupidDone && wolves.every((w) => game.wolfVotes.has(w.id))) endWolves(game);
}

async function endWolves(game) {
  if (game.phase !== 'night') return;
  clearTimeout(game.timer);
  const tally = new Map();
  for (const target of game.wolfVotes.values()) tally.set(target, (tally.get(target) ?? 0) + 1);
  const best = Math.max(0, ...tally.values());
  game.victim = best ? pick([...tally].filter(([, n]) => n === best).map(([id]) => id)) : null;
  const witch = alive(game).find((p) => p.role === 'sorciere');
  if (!witch || (!game.witch.heal && !game.witch.poison)) return dawn(game);
  game.phase = 'witch';
  await game.channel
    .send({
      content: `🧪 La sorcière se réveille… (${WITCH_MS / 1000} s)`,
      components: [new ActionRowBuilder().addComponents(button('lg:witch', 'Sorcière', ButtonStyle.Primary, '🧪'))],
      ...quiet,
    })
    .catch(() => {});
  game.timer = setTimeout(() => dawn(game), WITCH_MS);
}

function witchPanel(game, note = '') {
  const lines = [note, game.victim ? `🐺 Cette nuit, les loups attaquent **${name(game, game.victim)}**.` : '🐺 Les loups n’ont attaqué personne cette nuit.'];
  if (game.saved) lines.push('💚 Tu l’as sauvé(e) avec ta potion de vie.');
  lines.push(`Potions : ${game.witch.heal ? '💚 vie' : '~~vie~~'} · ${game.witch.poison ? '☠️ mort' : '~~mort~~'}`);
  const buttons = [];
  if (game.witch.heal && game.victim && !game.saved) buttons.push(button('lg:heal', 'Sauver la victime', ButtonStyle.Success, '💚'));
  buttons.push(button('lg:witchend', 'Terminer', ButtonStyle.Secondary));
  const rows = [new ActionRowBuilder().addComponents(buttons)];
  if (game.witch.poison) {
    rows.unshift(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('lg:poison')
          .setPlaceholder('☠️ Empoisonner quelqu’un…')
          .addOptions(alive(game).filter((p) => p.role !== 'sorciere').map((p) => ({ label: name(game, p.id), value: p.id }))),
      ),
    );
  }
  return { content: lines.filter(Boolean).join('\n'), components: rows };
}

// --- Jour : morts de la nuit, chasseur, débat, vote ---

function kill(game, ids) {
  const dead = [];
  for (const id of new Set(ids)) {
    const p = player(game, id);
    if (p?.alive) {
      p.alive = false;
      dead.push(p);
    }
  }
  // Un amoureux qui meurt emporte l'autre (mort de chagrin).
  for (const p of dead) {
    const partner = partnerOf(game, p.id);
    if (partner?.alive) {
      partner.alive = false;
      partner.grief = true;
      dead.push(partner);
    }
  }
  return dead;
}

function winner(game) {
  // Couple loup + village : il gagne s'il reste seul en vie.
  if (mixedLovers(game) && alive(game).length === 2 && lovers(game).every((p) => p.alive)) return 'amoureux';
  const wolves = alive(game).filter((p) => p.role === 'loup').length;
  if (!wolves) return 'village';
  if (wolves >= alive(game).length - wolves) return 'loups';
  return null;
}

async function dawn(game) {
  if (game.phase !== 'night' && game.phase !== 'witch') return;
  clearTimeout(game.timer);
  game.phase = 'dawn';
  unmuteAll(game.channel, 'Loup-garou : le jour se lève').catch(() => {});
  const dead = kill(game, [game.saved ? null : game.victim, game.poisoned].filter(Boolean));
  const lines = dead.filter((p) => !p.grief).map((p) => `💀 <@${p.id}> a été retrouvé(e) mort(e). C’était ${roleText(p)}.`);
  lines.push(...griefLines(dead));
  if (!lines.length) lines.push('✨ Personne n’est mort cette nuit !');
  if (game.night === 1 && game.lovers) lines.unshift('💘 Cupidon a frappé cette nuit : deux amoureux sont liés en secret.\n');
  const text = lines.join('\n');
  await game.channel
    .send({ embeds: [new EmbedBuilder().setColor(DAY_COLOR).setTitle(`☀️ Jour ${game.night}`).setDescription(text)], ...quiet })
    .catch(() => {});
  afterDeaths(game, dead, () => startDebate(game));
}

// Le chasseur qui vient de mourir tire, puis la partie continue (ou se termine).
function afterDeaths(game, dead, next) {
  const end = winner(game);
  const hunter = dead.find((p) => p.role === 'chasseur');
  if (hunter && alive(game).length) return hunterStep(game, hunter, next);
  if (end) return finish(game, end);
  return next();
}

async function hunterStep(game, hunter, next) {
  game.phase = 'hunter';
  game.hunter = { id: hunter.id, next };
  await game.channel
    .send({
      content: `🔫 <@${hunter.id}>, tu étais **Chasseur** : choisis quelqu’un à emporter avec toi ! (${HUNTER_MS / 1000} s)`,
      components: [
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('lg:shoot')
            .setPlaceholder('🔫 Tirer sur…')
            .addOptions(alive(game).map((p) => ({ label: name(game, p.id), value: p.id }))),
        ),
      ],
      allowedMentions: { users: [hunter.id] },
    })
    .catch(() => {});
  game.timer = setTimeout(() => hunterDone(game, null), HUNTER_MS);
}

async function hunterDone(game, targetId) {
  if (game.phase !== 'hunter') return;
  clearTimeout(game.timer);
  const { next } = game.hunter;
  game.hunter = null;
  game.phase = 'dawn';
  const dead = targetId ? kill(game, [targetId]) : [];
  await game.channel
    .send({
      content: dead.length
        ? [`🔫 Le chasseur emporte <@${dead[0].id}> avec lui… C’était ${roleText(dead[0])}.`, ...griefLines(dead)].join('\n')
        : '🔫 Le chasseur n’a tiré sur personne.',
      ...quiet,
    })
    .catch(() => {});
  const end = winner(game);
  if (end) return finish(game, end);
  return next();
}

async function startDebate(game) {
  game.phase = 'debate';
  await game.channel
    .send({ content: `💬 **Débattez !** Qui est le loup-garou ? Le vote commence dans ${DEBATE_MS / 1000} s.\n-# En vie : ${alive(game).map((p) => `<@${p.id}>`).join(' ')}`, ...quiet })
    .catch(() => {});
  game.timer = setTimeout(() => openVote(game), DEBATE_MS);
}

function votePayload(game, closed = false) {
  const voters = alive(game);
  const done = voters.filter((p) => game.votes.has(p.id)).length;
  return {
    content: `🗳️ **Vote du village** — qui éliminer ? (${done}/${voters.length} ont voté${closed ? '' : `, ${VOTE_MS / 1000} s`})`,
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('lg:vote')
          .setPlaceholder('🗳️ Éliminer…')
          .setDisabled(closed)
          .addOptions(voters.map((p) => ({ label: name(game, p.id), value: p.id }))),
      ),
      new ActionRowBuilder().addComponents(roleButton()),
    ],
    ...quiet,
  };
}

async function openVote(game) {
  if (game.phase !== 'debate') return;
  game.phase = 'vote';
  game.votes = new Map();
  game.voteMessage = await game.channel.send(votePayload(game)).catch(() => null);
  game.timer = setTimeout(() => closeVote(game), VOTE_MS);
}

async function closeVote(game) {
  if (game.phase !== 'vote') return;
  clearTimeout(game.timer);
  game.phase = 'dawn';
  await game.voteMessage?.edit(votePayload(game, true)).catch(() => {});
  const tally = new Map();
  for (const target of game.votes.values()) tally.set(target, (tally.get(target) ?? 0) + 1);
  const best = Math.max(0, ...tally.values());
  const top = [...tally].filter(([, n]) => n === best).map(([id]) => id);
  let dead = [];
  if (!best || top.length > 1) {
    await game.channel.send({ content: `⚖️ ${best ? 'Égalité' : 'Personne n’a voté'} : personne n’est éliminé aujourd’hui.`, ...quiet }).catch(() => {});
  } else {
    dead = kill(game, top);
    await game.channel
      .send({
        content: [`🪓 Le village élimine <@${dead[0].id}> avec **${best} voix**… C’était ${roleText(dead[0])}.`, ...griefLines(dead)].join('\n'),
        ...quiet,
      })
      .catch(() => {});
  }
  afterDeaths(game, dead, () => {
    game.timer = setTimeout(() => startNight(game), 5000);
  });
}

async function finish(game, team) {
  stop(game);
  // Un couple mixte ne gagne pas avec son camp : seulement ensemble, s'il reste seul.
  const inMixedCouple = (p) => mixedLovers(game) && game.lovers.includes(p.id);
  const winners =
    team === 'amoureux' ? lovers(game) : game.players.filter((p) => ROLES[p.role].team === team && !inMixedCouple(p));
  const paid = winners.filter((p) => awardChatGameWin(game.guildId, p.id, 'loupgarou'));
  const roles = game.players
    .map((p) => `${ROLES[p.role].emoji} <@${p.id}> — ${ROLES[p.role].name}${game.lovers?.includes(p.id) ? ' 💘' : ''}${p.alive ? '' : ' 💀'}`)
    .join('\n');
  const title = { village: '🧑‍🌾 Le village gagne !', loups: '🐺 Les loups-garous gagnent !', amoureux: '💘 Les amoureux gagnent !' }[team];
  const color = { village: 0x57f287, loups: 0xed4245, amoureux: 0xff69b4 }[team];
  await game.channel
    .send({
      embeds: [
        new EmbedBuilder()
          .setColor(color)
          .setTitle(title)
          .setDescription(
            `${roles}` + (paid.length ? `\n\n🪙 **+${formatMoney(chatGameReward('loupgarou'))}** coins pour ${paid.map((p) => `<@${p.id}>`).join(', ')}` : ''),
          )
          .setFooter({ text: 'Rejoue avec +lp · classement : +jeux top loupgarou' }),
      ],
      ...quiet,
    })
    .catch(() => {});
}

// --- Messages : « +lp » ---

export async function handleWerewolfMessage(message) {
  if (!message.guild || message.author.bot) return false;
  if (!/^\+(lp|loupgarou|loup-garou)$/i.test(message.content.trim())) return false;
  await openLobby(message);
  return true;
}

// --- Boutons et menus « lg:… » ---

export async function handleWerewolfInteraction(interaction) {
  const game = games.get(interaction.channelId);
  const action = interaction.customId.slice('lg:'.length);
  const ephemeral = (content, extra = {}) => interaction.reply({ content, ephemeral: true, ...extra });
  if (!game) return ephemeral('⌛ Cette partie est terminée. Lance-en une avec `+lp`.');
  const me = player(game, interaction.user.id);

  if (action === 'role') {
    if (!me?.role) return ephemeral('ℹ️ Tu ne joues pas dans cette partie.');
    const wolves = me.role === 'loup' ? game.players.filter((p) => p.role === 'loup' && p.id !== me.id) : [];
    return ephemeral(
      `${roleText(me)}${me.alive ? '' : ' (mort 💀)'}\n${ROLES[me.role].about}` +
        (wolves.length ? `\nTa meute : ${wolves.map((w) => `**${name(game, w.id)}**`).join(', ')}` : '') +
        (partnerOf(game, me.id) ? `\n💘 Tu es amoureux(se) de **${name(game, partnerOf(game, me.id).id)}** (${roleText(partnerOf(game, me.id))}).` : ''),
    );
  }

  // Salle d'attente.
  if (['join', 'leave', 'start', 'cancel'].includes(action)) {
    if (game.phase !== 'lobby' || interaction.message.id !== game.message.id) return ephemeral('⌛ La partie a déjà commencé.');
    const isHost = interaction.user.id === game.hostId;
    if (action === 'join') {
      if (me) return ephemeral('ℹ️ Tu es déjà inscrit.');
      if (game.players.length >= MAX_PLAYERS) return ephemeral(`❌ La partie est complète (${MAX_PLAYERS} joueurs).`);
      game.players.push({ id: interaction.user.id, alive: true });
      return interaction.update(lobbyPayload(game));
    }
    if (action === 'leave') {
      if (!me) return ephemeral('ℹ️ Tu n’es pas inscrit.');
      game.players = game.players.filter((p) => p.id !== interaction.user.id);
      if (!game.players.length) {
        stop(game);
        return interaction.update({ ...lobbyPayload(game, '🚪 Plus personne : partie annulée.'), components: [] });
      }
      if (isHost) game.hostId = game.players[0].id;
      return interaction.update(lobbyPayload(game));
    }
    if (action === 'cancel') {
      if (!isHost && !interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages)) return ephemeral('❌ Seul l’organisateur 👑 peut annuler.');
      stop(game);
      return interaction.update({ ...lobbyPayload(game, '✖️ Partie annulée.'), components: [] });
    }
    if (!isHost) return ephemeral('❌ Seul l’organisateur 👑 peut lancer la partie.');
    if (game.players.length < MIN_PLAYERS) return ephemeral(`❌ Il faut au moins ${MIN_PLAYERS} joueurs.`);
    for (const p of game.players) {
      const member = await interaction.guild.members.fetch(p.id).catch(() => null);
      game.names.set(p.id, member?.displayName ?? p.id);
    }
    game.phase = 'starting';
    await interaction.deferUpdate();
    return launch(game);
  }

  if (!me) return ephemeral('ℹ️ Tu ne joues pas dans cette partie.');
  if (!me.alive && action !== 'shoot') return ephemeral('👻 Tu es mort… tu ne peux plus agir.');

  // Nuit : chacun clique, seuls les loups et la voyante ont quelque chose à faire.
  if (action === 'act') {
    if (game.phase !== 'night') return ephemeral('⌛ Ce n’est pas la nuit.');
    if (me.role === 'loup') return ephemeral('', wolfPanel(game, me));
    if (me.role === 'voyante' && !game.seerDone) {
      return ephemeral('🔮 **De qui veux-tu découvrir le rôle ?**', {
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('lg:seer')
              .setPlaceholder('Sonder…')
              .addOptions(alive(game).filter((p) => p.id !== me.id).map((p) => ({ label: name(game, p.id), value: p.id }))),
          ),
        ],
      });
    }
    if (me.role === 'cupidon' && !game.cupidDone) {
      return ephemeral('💘 **Désigne deux amoureux** (toi compris si tu veux). Si l’un meurt, l’autre meurt de chagrin.', {
        components: [
          new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
              .setCustomId('lg:cupid')
              .setPlaceholder('Les deux amoureux…')
              .setMinValues(2)
              .setMaxValues(2)
              .addOptions(alive(game).map((p) => ({ label: name(game, p.id), value: p.id }))),
          ),
        ],
      });
    }
    return ephemeral('💤 Tu dors… Rien à faire cette nuit.');
  }
  if (action === 'cupid') {
    if (game.phase !== 'night' || me.role !== 'cupidon' || game.cupidDone) return ephemeral('⌛ Trop tard.');
    const [a, b] = interaction.values.map((id) => player(game, id));
    if (!a?.alive || !b?.alive || a.id === b.id) return ephemeral('❌ Choisis deux joueurs en vie.');
    game.lovers = [a.id, b.id];
    game.cupidDone = true;
    await interaction.update({ content: `💘 **${name(game, a.id)}** et **${name(game, b.id)}** sont maintenant amoureux.`, components: [] });
    // Chaque amoureux apprend qui est l'autre (et son rôle) en MP ; sinon avec « 🔍 Mon rôle ».
    for (const [lover, other] of [[a, b], [b, a]]) {
      const goal = mixedLovers(game)
        ? '\nVous n’êtes pas du même camp : vous gagnez ensemble si vous êtes les deux derniers en vie.'
        : '';
      await game.channel.client.users
        .send(lover.id, `💘 **Loup-garou** dans ${game.channel} : Cupidon t’a lié(e) à **${name(game, other.id)}** (${roleText(other)}). Si l’un de vous meurt, l’autre meurt de chagrin.${goal}`)
        .catch(() => {});
    }
    return checkNightDone(game);
  }
  if (action === 'wolf') {
    if (game.phase !== 'night' || me.role !== 'loup') return ephemeral('⌛ Trop tard.');
    const target = player(game, interaction.values[0]);
    if (!target?.alive || target.role === 'loup') return ephemeral('❌ Choisis un villageois en vie.');
    game.wolfVotes.set(me.id, target.id);
    await interaction.update(wolfPanel(game, me, `✅ Ton vote : **${name(game, target.id)}**`));
    return checkNightDone(game);
  }
  if (action === 'seer') {
    if (game.phase !== 'night' || me.role !== 'voyante' || game.seerDone) return ephemeral('⌛ Trop tard.');
    const target = player(game, interaction.values[0]);
    game.seerDone = true;
    await interaction.update({ content: `🔮 **${name(game, target.id)}** est ${roleText(target)}.`, components: [] });
    return checkNightDone(game);
  }

  // Sorcière.
  if (['witch', 'heal', 'poison', 'witchend'].includes(action)) {
    if (game.phase !== 'witch' || me.role !== 'sorciere') return ephemeral(action === 'witch' ? '❌ Tu n’es pas la sorcière.' : '⌛ Trop tard.');
    if (action === 'witch') return ephemeral('', witchPanel(game));
    if (action === 'heal' && game.witch.heal && game.victim) {
      game.saved = true;
      game.witch.heal = false;
      return interaction.update(witchPanel(game, '💚 Potion de vie utilisée.'));
    }
    if (action === 'poison' && game.witch.poison) {
      game.poisoned = interaction.values[0];
      game.witch.poison = false;
      await interaction.update({ content: `☠️ Tu empoisonnes **${name(game, game.poisoned)}**.`, components: [] });
      return dawn(game);
    }
    await interaction.update({ content: '🧪 Tu te rendors.', components: [] });
    return dawn(game);
  }

  // Chasseur.
  if (action === 'shoot') {
    if (game.phase !== 'hunter' || game.hunter?.id !== me.id) return ephemeral('❌ Seul le chasseur peut tirer.');
    await interaction.deferUpdate();
    await interaction.message.edit({ components: [] }).catch(() => {});
    return hunterDone(game, interaction.values[0]);
  }

  // Vote du village.
  if (action === 'vote') {
    if (game.phase !== 'vote' || interaction.message.id !== game.voteMessage?.id) return ephemeral('⌛ Ce vote est terminé.');
    const target = interaction.values[0];
    if (target === me.id) return ephemeral('❌ Tu ne peux pas voter contre toi.');
    game.votes.set(me.id, target);
    await interaction.update(votePayload(game)).catch(() => {});
    if (game.votes.size === alive(game).length) closeVote(game);
  }
}
