import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getCoins } from './store.js';
import { checkBet, holdBet, settleHold, newGameId } from './bets.js';
import { formatMoney } from './shop.js';

// Duels (/duel) entre deux membres : morpion, puissance 4 ou pierre-feuille-ciseaux (en 2 manches gagnantes),
// avec une mise facultative (chacun mise autant, le gagnant remporte tout ; égalité = mises rendues).
// Sans membre, on joue contre le bot (vsBot) : il joue tout de suite après chaque coup ; la mise se joue
// contre la banque (gagné = mise ×2, perdu = mise perdue, égalité = rendue).
// Boutons duel:<id>:<action>[:<valeur>] ; 60 s pour accepter, 60 s par coup (sinon le joueur perd par forfait).
const WAIT_MS = 60_000;
const duels = new Map();

export const DUEL_GAMES = {
  morpion: { label: 'Morpion', emoji: '❌' },
  puissance4: { label: 'Puissance 4', emoji: '🔴' },
  pfc: { label: 'Pierre-feuille-ciseaux', emoji: '✂️' },
};
const MARKS = { morpion: ['❌', '⭕'], puissance4: ['🔴', '🟡'], pfc: ['🔵', '🟠'] };
const RPS = { pierre: '🪨', feuille: '📄', ciseaux: '✂️' };
const BEATS = { pierre: 'ciseaux', feuille: 'pierre', ciseaux: 'feuille' };
const LINES3 = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
const ROWS = 6;
const COLS = 7;

const inDuel = (userId) => [...duels.values()].some((d) => d.players.includes(userId));
const holdKey = (duel, i) => `duel:${duel.id}:${duel.players[i]}`;

export async function startDuel(interaction) {
  const { guild, user } = interaction;
  const target = interaction.options.getMember('membre');
  const game = interaction.options.getString('jeu', true);
  const raw = interaction.options.getString('mise');
  const reply = (content) => interaction.reply({ content, ephemeral: true });
  if (!interaction.options.getUser('membre')) return startBotDuel(interaction, game, raw);
  if (!target) return reply('❌ Ce membre n’est pas sur le serveur.');
  if (target.user.bot) return reply('❌ On ne peut pas défier un bot : laisse `membre` vide pour jouer contre moi.');
  if (target.id === user.id) return reply('❌ Tu ne peux pas te défier toi-même.');
  if (inDuel(user.id)) return reply('❌ Tu as déjà un duel en cours.');
  if (inDuel(target.id)) return reply(`❌ ${target} a déjà un duel en cours.`);
  let bet = 0;
  if (raw) {
    const check = checkBet(guild.id, user.id, raw);
    if (check.error) return reply(check.error);
    bet = check.bet;
    const theirs = getCoins(guild.id, target.id);
    if (theirs < bet) return reply(`❌ ${target} n’a que 🪙 **${formatMoney(theirs)}** en poche : choisis une mise plus petite.`);
  }
  const duel = {
    id: newGameId(),
    guildId: guild.id,
    game,
    bet,
    players: [user.id, target.id],
    status: 'pending',
  };
  duels.set(duel.id, duel);
  duel.last = interaction;
  await interaction.reply({
    content: `${target}`,
    embeds: [
      new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle(`⚔️ Défi — ${DUEL_GAMES[game].label}`)
        .setDescription(
          `${user} te défie au **${DUEL_GAMES[game].label.toLowerCase()}** !\n` +
            (bet ? `🪙 Mise : **${formatMoney(bet)}** chacun — le gagnant remporte 🪙 **${formatMoney(bet * 2)}**.` : 'Sans mise, juste pour la gloire.') +
            '\n\nTu as 60 secondes pour répondre.',
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`duel:${duel.id}:accept`).setLabel('Accepter').setEmoji('⚔️').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`duel:${duel.id}:decline`).setLabel('Refuser').setStyle(ButtonStyle.Secondary),
      ),
    ],
    allowedMentions: { users: [target.id] },
  });
  arm(duel);
}

// Duel contre le bot : commence tout de suite (le bot joue en premier une fois sur deux).
async function startBotDuel(interaction, game, raw) {
  const { guild, user } = interaction;
  if (inDuel(user.id)) return interaction.reply({ content: '❌ Tu as déjà un duel en cours.', ephemeral: true });
  let bet = 0;
  if (raw) {
    const check = checkBet(guild.id, user.id, raw);
    if (check.error) return interaction.reply({ content: check.error, ephemeral: true });
    bet = check.bet;
  }
  const duel = { id: newGameId(), guildId: guild.id, game, bet, players: [user.id, interaction.client.user.id], vsBot: true, status: 'pending' };
  duels.set(duel.id, duel);
  begin(duel);
  if (duel.turn === 1 && game !== 'pfc') playMove(duel, 1, botMove(duel));
  duel.last = interaction;
  await interaction.reply(view(duel));
  arm(duel);
}

// Délai : défi sans réponse, ou joueur qui ne joue pas (il perd par forfait).
function arm(duel) {
  clearTimeout(duel.timer);
  duel.timer = setTimeout(async () => {
    if (!duels.has(duel.id)) return;
    if (duel.status === 'pending') {
      duels.delete(duel.id);
      await duel.last.editReply({ content: '', embeds: [simpleEmbed(duel, '⌛ Défi expiré : pas de réponse.')], components: [] }).catch(() => {});
      return;
    }
    let loser;
    if (duel.vsBot) loser = 0; // contre le bot, seul le joueur peut ne pas jouer
    else if (duel.game === 'pfc') {
      const missing = [0, 1].filter((i) => !duel.picks[i]);
      loser = missing.length === 1 ? missing[0] : null; // personne n'a joué : duel annulé
    } else loser = duel.turn;
    end(duel, loser === null ? null : 1 - loser, loser === null ? 'Personne n’a joué : duel annulé.' : `<@${duel.players[loser]}> n’a pas joué à temps : forfait.`);
    await duel.last.editReply(view(duel)).catch(() => {});
  }, WAIT_MS);
}

function simpleEmbed(duel, text) {
  return new EmbedBuilder().setColor(0x95a5a6).setTitle(`⚔️ Duel — ${DUEL_GAMES[duel.game].label}`).setDescription(text);
}

function begin(duel) {
  duel.status = 'playing';
  duel.turn = Math.random() < 0.5 ? 0 : 1;
  if (duel.game === 'morpion') duel.board = Array(9).fill(null);
  else if (duel.game === 'puissance4') duel.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
  else {
    duel.picks = [null, null];
    duel.score = [0, 0];
    duel.rounds = [];
  }
  // Contre le bot, seul le joueur mise (contre la banque).
  if (duel.bet) duel.players.forEach((id, i) => !(duel.vsBot && i === 1) && holdBet(duel.guildId, holdKey(duel, i), id, duel.bet));
}

// Fin du duel : winner = 0 ou 1, ou null (égalité / annulé : mises rendues).
function end(duel, winner, reason) {
  clearTimeout(duel.timer);
  duels.delete(duel.id);
  duel.status = 'done';
  duel.winner = winner;
  duel.reason = reason;
  if (!duel.bet) return;
  if (duel.vsBot) {
    settleHold(duel.guildId, holdKey(duel, 0), winner === null ? duel.bet : winner === 0 ? duel.bet * 2 : 0);
    return;
  }
  duel.players.forEach((_, i) => settleHold(duel.guildId, holdKey(duel, i), duel.bet, winner === null ? null : duel.players[winner]));
}

// Joue un coup (morpion : case 0-8 ; puissance 4 : colonne 0-6). Renvoie false si le coup est impossible.
function playMove(duel, who, value) {
  if (duel.game === 'morpion') {
    const i = Number(value);
    if (duel.board[i] !== null) return false;
    duel.board[i] = who;
    const line = LINES3.find((l) => l.every((c) => duel.board[c] === who));
    if (line) {
      duel.winCells = line;
      end(duel, who);
    } else if (duel.board.every((v) => v !== null)) end(duel, null);
  } else {
    const c = Number(value);
    const r = duel.board.findLastIndex((row) => row[c] === null);
    if (r === -1) return false;
    duel.board[r][c] = who;
    const cells = connect4Winner(duel.board, r, c);
    if (cells) {
      duel.winCells = cells;
      end(duel, who);
    } else if (duel.board[0].every((v) => v !== null)) end(duel, null);
  }
  if (duel.status !== 'done') duel.turn = 1 - who;
  return true;
}

// --- Le bot (joueur 1) : gagne s'il peut, bloque sinon, et laisse un peu de hasard pour rester battable. ---
const shuffled = (list) => list.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

function botMove(duel) {
  return duel.game === 'morpion' ? botMorpion(duel.board) : botConnect4(duel.board);
}

function botMorpion(board) {
  const empty = shuffled(board.map((v, i) => (v === null ? i : null)).filter((i) => i !== null));
  const completes = (who) => empty.find((i) => LINES3.some((l) => l.includes(i) && l.every((c) => c === i || board[c] === who)));
  const win = completes(1);
  if (win !== undefined) return win;
  const block = completes(0);
  if (block !== undefined && Math.random() < 0.9) return block;
  if (Math.random() < 0.25) return empty[0];
  // Centre, puis coins, puis bords.
  return [4, 0, 2, 6, 8, 1, 3, 5, 7].find((i) => empty.includes(i));
}

function botConnect4(board) {
  const open = (b) => [...Array(COLS).keys()].filter((c) => b[0][c] === null);
  const drop = (b, c, who) => {
    const copy = b.map((row) => [...row]);
    const r = copy.findLastIndex((row) => row[c] === null);
    copy[r][c] = who;
    return { b: copy, r };
  };
  const winsWith = (b, c, who) => {
    const { b: next, r } = drop(b, c, who);
    return Boolean(connect4Winner(next, r, c));
  };
  const cols = shuffled(open(board));
  const win = cols.find((c) => winsWith(board, c, 1));
  if (win !== undefined) return win;
  const block = cols.find((c) => winsWith(board, c, 0));
  if (block !== undefined && Math.random() < 0.9) return block;
  // Coups qui n'offrent pas une victoire au joueur juste au-dessus.
  const safe = cols.filter((c) => {
    const { b } = drop(board, c, 1);
    return !open(b).some((c2) => winsWith(b, c2, 0));
  });
  const pool = safe.length ? safe : cols;
  if (Math.random() < 0.2) return pool[0];
  // Plutôt vers le centre.
  return pool.sort((a, b) => Math.abs(a - 3) - Math.abs(b - 3))[0];
}

function connect4Winner(board, r, c) {
  const who = board[r][c];
  for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
    const cells = [[r, c]];
    for (const sign of [1, -1]) {
      let rr = r + dr * sign;
      let cc = c + dc * sign;
      while (rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS && board[rr][cc] === who) {
        cells.push([rr, cc]);
        rr += dr * sign;
        cc += dc * sign;
      }
    }
    if (cells.length >= 4) return cells;
  }
  return null;
}

function view(duel) {
  const [a, b] = duel.players;
  const marks = MARKS[duel.game];
  const lines = [`<@${a}> ${marks[0]}  **contre**  ${marks[1]} <@${b}>${duel.vsBot ? ' 🤖' : ''}`];
  if (duel.bet) lines.push(duel.vsBot ? `🪙 Mise : **${formatMoney(duel.bet)}** contre la banque (gagné : ×2)` : `🪙 Mise : **${formatMoney(duel.bet)}** chacun`);
  lines.push('');

  if (duel.game === 'puissance4') {
    lines.push('1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣');
    const win = new Set((duel.winCells ?? []).map(([r, c]) => `${r}:${c}`));
    for (let r = 0; r < ROWS; r++) {
      lines.push(duel.board[r].map((v, c) => (win.has(`${r}:${c}`) ? '🟢' : v === null ? '⚪' : marks[v])).join(''));
    }
    lines.push('');
  } else if (duel.game === 'pfc') {
    lines.push(`Score : **${duel.score[0]}** – **${duel.score[1]}** (2 manches gagnantes)`);
    for (const [i, r] of duel.rounds.entries()) {
      lines.push(`Manche ${i + 1} : ${RPS[r[0]]} contre ${RPS[r[1]]} → ${r.winner === null ? 'égalité' : `<@${duel.players[r.winner]}>`}`);
    }
    lines.push('');
  }

  let color = 0xe67e22;
  if (duel.status === 'done') {
    color = duel.winner === null ? 0x95a5a6 : 0x2ecc71;
    if (duel.reason) lines.push(duel.reason);
    if (duel.winner === null) lines.push(`🤝 **Égalité**${duel.bet ? ' : les mises sont rendues.' : '.'}`);
    else if (duel.vsBot && duel.winner === 1) lines.push(`🤖 **<@${b}> gagne le duel !**${duel.bet ? ` 🪙 **-${formatMoney(duel.bet)}**` : ''}`);
    else lines.push(`🏆 **<@${duel.players[duel.winner]}> gagne le duel !**${duel.bet ? ` 🪙 **+${formatMoney(duel.bet)}**` : ''}`);
  } else if (duel.game === 'pfc') {
    lines.push(duel.picks.map((p, i) => `${p ? '✅' : '⏳'} <@${duel.players[i]}>`).join('  ·  '), '-# Chacun choisit en secret, 60 s par manche.');
  } else {
    lines.push(`C’est au tour de <@${duel.players[duel.turn]}> ${marks[duel.turn]}`, '-# 60 secondes par coup, sinon forfait.');
  }

  const embed = new EmbedBuilder().setColor(color).setTitle(`⚔️ Duel — ${DUEL_GAMES[duel.game].label}`).setDescription(lines.join('\n'));
  return { content: '', embeds: [embed], components: buttons(duel), allowedMentions: { parse: [] } };
}

function buttons(duel) {
  const done = duel.status === 'done';
  if (duel.game === 'morpion') {
    const win = new Set(duel.winCells ?? []);
    return [0, 1, 2].map((row) =>
      new ActionRowBuilder().addComponents(
        [0, 1, 2].map((col) => {
          const i = row * 3 + col;
          const v = duel.board[i];
          const btn = new ButtonBuilder()
            .setCustomId(`duel:${duel.id}:m:${i}`)
            .setStyle(win.has(i) ? ButtonStyle.Success : v === null ? ButtonStyle.Secondary : ButtonStyle.Primary)
            .setDisabled(done || v !== null);
          return v === null ? btn.setLabel('​') : btn.setEmoji(MARKS.morpion[v]);
        }),
      ),
    );
  }
  if (done) return [];
  if (duel.game === 'puissance4') {
    const col = (c) =>
      new ButtonBuilder()
        .setCustomId(`duel:${duel.id}:p:${c}`)
        .setLabel(String(c + 1))
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(duel.board[0][c] !== null);
    return [new ActionRowBuilder().addComponents([0, 1, 2, 3].map(col)), new ActionRowBuilder().addComponents([4, 5, 6].map(col))];
  }
  return [
    new ActionRowBuilder().addComponents(
      Object.entries(RPS).map(([key, emoji]) =>
        new ButtonBuilder().setCustomId(`duel:${duel.id}:r:${key}`).setLabel(key[0].toUpperCase() + key.slice(1)).setEmoji(emoji).setStyle(ButtonStyle.Primary),
      ),
    ),
  ];
}

export async function handleDuelInteraction(interaction) {
  const [, id, action, value] = interaction.customId.split(':');
  const duel = duels.get(id);
  const reply = (content) => interaction.reply({ content, ephemeral: true });
  if (!duel) return reply('⌛ Ce duel est terminé.');
  const me = duel.players.indexOf(interaction.user.id);
  if (me === -1) return reply('❌ Ce duel ne te concerne pas : lance le tien avec `/duel`.');

  if (duel.status === 'pending') {
    if (action === 'decline') {
      clearTimeout(duel.timer);
      duels.delete(duel.id);
      const text = me === 1 ? `✖️ <@${duel.players[1]}> a refusé le duel.` : `✖️ <@${duel.players[0]}> a annulé son défi.`;
      return interaction.update({ content: '', embeds: [simpleEmbed(duel, text)], components: [], allowedMentions: { parse: [] } });
    }
    if (me !== 1) return reply('⏳ On attend la réponse de ton adversaire.');
    if (duel.bet) {
      const poor = duel.players.find((uid) => getCoins(duel.guildId, uid) < duel.bet);
      if (poor) {
        clearTimeout(duel.timer);
        duels.delete(duel.id);
        return interaction.update({ content: '', embeds: [simpleEmbed(duel, `❌ <@${poor}> n’a plus 🪙 **${formatMoney(duel.bet)}** en poche : duel annulé.`)], components: [], allowedMentions: { parse: [] } });
      }
    }
    begin(duel);
    arm(duel);
    duel.last = interaction; // message du duel, modifié à la fin par forfait
    return interaction.update(view(duel));
  }

  if (duel.game === 'pfc') {
    if (action !== 'r' || !RPS[value]) return interaction.deferUpdate();
    if (duel.picks[me]) return reply(`Tu as déjà choisi ${RPS[duel.picks[me]]} pour cette manche.`);
    duel.picks[me] = value;
    if (duel.vsBot) duel.picks[1] = Object.keys(RPS)[Math.floor(Math.random() * 3)];
    const roundDone = Boolean(duel.picks[1 - me]);
    if (roundDone) {
      const [p0, p1] = duel.picks;
      const winner = p0 === p1 ? null : BEATS[p0] === p1 ? 0 : 1;
      duel.rounds.push(Object.assign([p0, p1], { winner }));
      if (winner !== null) duel.score[winner]++;
      duel.picks = [null, null];
      if (winner !== null && duel.score[winner] === 2) end(duel, winner);
      else arm(duel);
    }
    duel.last = interaction;
    await interaction.update(view(duel));
    if (!roundDone) await interaction.followUp({ content: `Choix enregistré en secret : ${RPS[value]}`, ephemeral: true }).catch(() => {});
    return;
  }

  if (me !== duel.turn) return reply('⏳ Ce n’est pas ton tour.');
  if (!playMove(duel, me, value)) return interaction.deferUpdate();
  // Contre le bot : il répond aussitôt.
  if (duel.vsBot && duel.status !== 'done') playMove(duel, 1, botMove(duel));
  if (duel.status !== 'done') arm(duel);
  duel.last = interaction;
  return interaction.update(view(duel));
}
