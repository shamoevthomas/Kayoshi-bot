import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getCoins, addCoins, getHeist, patchHeist } from './store.js';
import { holdBet, settleHold, againRow, newGameId } from './bets.js';
import { formatMoney } from './shop.js';
import { boostedMoney } from './levels.js';

// Jeux du casino (commandes « . ») : .mines, .hilo, .crash, .course, .gratter, .tour, .plinko et .braquage. Les mises
// sont prises dans la poche (coins) et gardées « en jeu » jusqu'à la fin (lib/bets.js). La banque garde un petit
// avantage (EDGE). Boutons cas_mn:…, cas_hl:…, cas_cr:…, cas_gr:…, cas_to:…, cas_bq:… routés par lib/casino.js.
const EDGE = 0.97;
const TURN_MS = 60_000;
const games = new Map(); // id → partie (mines, hilo, crash, braquage)
const round2 = (n) => Math.floor(n * 100) / 100;
// Gain d'une mise × multiplicateur, à l'unité près (sans l'erreur d'arrondi : 100 × 1,14 = 113,999…).
const payout = (bet, m) => Math.floor(bet * m + 1e-6);
const mult = (n) => `×${n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const rand = (min, max) => min + Math.random() * (max - min);
const name = (user) => user.displayName ?? user.username;
const notYours = (interaction, game) =>
  interaction.reply({ content: `❌ Ce n’est pas ta partie : lance la tienne avec \`.${game}\`.`, ephemeral: true });

function finish(game, payout) {
  clearTimeout(game.timer);
  game.done = true;
  games.delete(game.id);
  game.payout = payout;
  game.pocket = settleHold(game.guildId, game.key, payout);
}

function arm(game, onTimeout) {
  clearTimeout(game.timer);
  game.timer = setTimeout(async () => {
    if (game.done) return;
    onTimeout();
    await game.last?.editReply(game.view()).catch(() => {});
  }, TURN_MS);
}

function newGame(interaction, kind, bet, extra) {
  const { guild, user } = interaction;
  const game = { id: newGameId(), guildId: guild.id, userId: user.id, name: name(user), bet, ...extra };
  game.key = `${kind}:${game.id}`;
  holdBet(guild.id, game.key, user.id, bet);
  games.set(game.id, game);
  game.last = interaction;
  return game;
}

// --- .mines <mise> [bombes] : 20 cases, des bombes cachées ; chaque case sûre fait monter le gain ---
const CELLS = 20;
const minesMult = (safe, bombs) => {
  let m = 1;
  for (let i = 0; i < safe; i++) m *= (CELLS - i) / (CELLS - bombs - i);
  return round2(m * EDGE);
};

export async function startMines(interaction, bet, bombs = 3) {
  const mines = new Set();
  while (mines.size < bombs) mines.add(Math.floor(Math.random() * CELLS));
  const game = newGame(interaction, 'mn', bet, { bombs, mines, opened: new Set(), lost: null });
  game.view = () => minesView(game);
  await interaction.reply(game.view());
  arm(game, () => finish(game, game.opened.size ? payout(bet, minesMult(game.opened.size, bombs)) : bet));
}

function minesView(game) {
  const safe = game.opened.size;
  const now = minesMult(safe, game.bombs);
  const next = minesMult(safe + 1, game.bombs);
  const lines = [`🪙 Mise : **${formatMoney(game.bet)}** · 💣 **${game.bombs}** bombe(s) sur ${CELLS} cases`, ''];
  let color = 0x2b2d31;
  if (!game.done) {
    lines.push(safe ? `💎 **${safe}** case(s) sûre(s) : ${mult(now)} → 🪙 **${formatMoney(payout(game.bet, now))}**` : 'Clique sur une case. Évite les bombes !', `Prochaine case sûre : ${mult(next)}`);
  } else if (game.lost !== null) {
    color = 0xe74c3c;
    lines.push(`💥 **BOUM !** Tu es tombé sur une bombe. 🪙 **-${formatMoney(game.bet)}**`);
  } else {
    color = game.payout > game.bet ? 0x2ecc71 : 0x95a5a6;
    lines.push(safe ? `💰 **Encaissé à ${mult(now)}** : 🪙 **+${formatMoney(game.payout - game.bet)}**` : '⌛ Pas de case ouverte : ta mise est rendue.');
  }
  const rows = [0, 1, 2, 3].map((r) =>
    new ActionRowBuilder().addComponents(
      [0, 1, 2, 3, 4].map((c) => {
        const i = r * 5 + c;
        const btn = new ButtonBuilder().setCustomId(`cas_mn:${game.id}:${i}`).setDisabled(game.done || game.opened.has(i));
        if (game.opened.has(i)) return btn.setEmoji('💎').setStyle(ButtonStyle.Success);
        if (game.done && game.mines.has(i)) return btn.setEmoji(i === game.lost ? '💥' : '💣').setStyle(ButtonStyle.Danger);
        return btn.setLabel('​').setStyle(ButtonStyle.Secondary);
      }),
    ),
  );
  rows.push(
    game.done
      ? againRow(game.userId, 'mn', game.bet, String(game.bombs))
      : new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`cas_mn:${game.id}:cash`)
            .setLabel(safe ? `Encaisser ${mult(now)} (${formatMoney(payout(game.bet, now))})` : 'Encaisser')
            .setEmoji('💰')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!safe),
        ),
  );
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('💣 Mines')
    .setDescription(lines.join('\n'))
    .setFooter({ text: game.done ? `${game.name} · Poche : ${formatMoney(game.pocket)}` : `${game.name} · 60 s par coup, sinon encaissement automatique` });
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

async function minesClick(interaction, game, value) {
  if (value === 'cash') {
    if (!game.opened.size) return interaction.deferUpdate();
    finish(game, payout(game.bet, minesMult(game.opened.size, game.bombs)));
  } else {
    const i = Number(value);
    if (game.opened.has(i)) return interaction.deferUpdate();
    if (game.mines.has(i)) {
      game.lost = i;
      finish(game, 0);
    } else {
      game.opened.add(i);
      // Toutes les cases sûres trouvées : encaissement automatique.
      if (game.opened.size === CELLS - game.bombs) finish(game, payout(game.bet, minesMult(game.opened.size, game.bombs)));
      else arm(game, () => finish(game, payout(game.bet, minesMult(game.opened.size, game.bombs))));
    }
  }
  game.last = interaction;
  return interaction.update(game.view());
}

// --- .hilo <mise> : la carte suivante sera-t-elle plus haute (ou égale) ou plus basse (ou égale) ? ---
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'V', 'D', 'R'];
const SUITS = ['♠', '♥', '♦', '♣'];
const drawCard = () => ({ value: 1 + Math.floor(Math.random() * 13), suit: SUITS[Math.floor(Math.random() * 4)] });
const cardText = (c) => `${RANKS[c.value - 1]}${c.suit}`;
const hiloMult = (value, up) => round2(EDGE / ((up ? 14 - value : value) / 13));

export async function startHilo(interaction, bet) {
  const game = newGame(interaction, 'hl', bet, { card: drawCard(), history: [], total: 1, streak: 0, lostOn: null });
  game.view = () => hiloView(game);
  await interaction.reply(game.view());
  arm(game, () => finish(game, game.streak ? payout(bet, game.total) : bet));
}

function hiloView(game) {
  const up = hiloMult(game.card.value, true);
  const down = hiloMult(game.card.value, false);
  const win = payout(game.bet, game.total);
  const lines = [
    `🪙 Mise : **${formatMoney(game.bet)}**`,
    game.history.length ? `Cartes : ${game.history.map((c) => `\`${cardText(c)}\``).join(' → ')} → **\`${cardText(game.card)}\`**` : `Carte : **\`${cardText(game.card)}\`**`,
    '',
  ];
  let color = 0x2b2d31;
  if (!game.done) lines.push(game.streak ? `✅ **${game.streak}** bonne(s) réponse(s) : ${mult(game.total)} → 🪙 **${formatMoney(win)}**` : 'La prochaine carte sera-t-elle plus haute ou plus basse ?');
  else if (game.lostOn) {
    color = 0xe74c3c;
    lines.push(`❌ **Raté !** 🪙 **-${formatMoney(game.bet)}**`);
  } else {
    color = game.payout > game.bet ? 0x2ecc71 : 0x95a5a6;
    lines.push(game.streak ? `💰 **Encaissé à ${mult(game.total)}** : 🪙 **+${formatMoney(game.payout - game.bet)}**` : '⌛ Pas de réponse : ta mise est rendue.');
  }
  const components = game.done
    ? [againRow(game.userId, 'hl', game.bet)]
    : [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`cas_hl:${game.id}:up`).setLabel(`Plus haut ou égal ${mult(up)}`).setEmoji('⬆️').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId(`cas_hl:${game.id}:down`).setLabel(`Plus bas ou égal ${mult(down)}`).setEmoji('⬇️').setStyle(ButtonStyle.Danger),
          new ButtonBuilder()
            .setCustomId(`cas_hl:${game.id}:cash`)
            .setLabel(game.streak ? `Encaisser (${formatMoney(win)})` : 'Encaisser')
            .setEmoji('💰')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!game.streak),
        ),
      ];
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('🃏 Hi-Lo')
    .setDescription(lines.join('\n'))
    .setFooter({ text: game.done ? `${game.name} · Poche : ${formatMoney(game.pocket)}` : `${game.name} · As = 1, Roi = 13 · 60 s par coup` });
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

async function hiloClick(interaction, game, value) {
  if (value === 'cash') {
    if (!game.streak) return interaction.deferUpdate();
    finish(game, payout(game.bet, game.total));
  } else {
    const up = value === 'up';
    const next = drawCard();
    const ok = up ? next.value >= game.card.value : next.value <= game.card.value;
    const m = hiloMult(game.card.value, up);
    game.history.push(game.card);
    game.card = next;
    if (!ok) {
      game.lostOn = next;
      finish(game, 0);
    } else {
      game.total = round2(game.total * m);
      game.streak++;
      arm(game, () => finish(game, payout(game.bet, game.total)));
    }
  }
  game.last = interaction;
  return interaction.update(game.view());
}

// --- .crash <mise> [auto] : le multiplicateur monte, encaisse avant qu'il explose ---
const CRASH_TICK_MS = 1500;
const growth = (ms) => round2(Math.exp(0.00012 * ms)); // ×2 vers 6 s, ×5 vers 13 s, ×10 vers 19 s

export async function startCrash(interaction, bet, auto = null) {
  // P(crash ≥ x) = EDGE / x ; 3 % des parties explosent dès le départ.
  const crashAt = Math.max(1, round2(EDGE / (1 - Math.random())));
  const game = newGame(interaction, 'cr', bet, { crashAt, auto, startedAt: Date.now(), cashedAt: null });
  game.view = () => crashView(game);
  await interaction.reply(game.view());
  crashLoop(game);
}

const current = (game) => Math.min(growth(Date.now() - game.startedAt), game.crashAt);

function crashLoop(game) {
  game.timer = setTimeout(async () => {
    if (game.done) return;
    const m = growth(Date.now() - game.startedAt);
    if (game.auto && game.auto <= game.crashAt && m >= game.auto) {
      game.cashedAt = game.auto;
      finish(game, payout(game.bet, game.auto));
    } else if (m >= game.crashAt) finish(game, 0);
    await game.last.editReply(game.view()).catch(() => {});
    if (!game.done) crashLoop(game);
  }, CRASH_TICK_MS);
}

function crashView(game) {
  const lines = [`🪙 Mise : **${formatMoney(game.bet)}**${game.auto ? ` · encaissement auto à ${mult(game.auto)}` : ''}`, ''];
  let color = 0xf1c40f;
  if (!game.done) {
    const m = current(game);
    lines.push(`# 🚀 ${mult(m)}`, `Gain si tu encaisses : 🪙 **${formatMoney(payout(game.bet, m))}**`);
  } else if (game.cashedAt) {
    color = 0x2ecc71;
    lines.push(`# 💰 ${mult(game.cashedAt)}`, `Encaissé avant l’explosion (qui est arrivée à ${mult(game.crashAt)}) : 🪙 **+${formatMoney(game.payout - game.bet)}**`);
  } else {
    color = 0xe74c3c;
    lines.push(`# 💥 ${mult(game.crashAt)}`, `Crash ! 🪙 **-${formatMoney(game.bet)}**`);
  }
  const components = game.done
    ? [againRow(game.userId, 'cr', game.bet, game.auto ? String(game.auto) : '')]
    : [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`cas_cr:${game.id}:cash`).setLabel('Encaisser').setEmoji('💰').setStyle(ButtonStyle.Success))];
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('📈 Crash')
    .setDescription(lines.join('\n'))
    .setFooter({ text: game.done ? `${game.name} · Poche : ${formatMoney(game.pocket)}` : `${game.name} · encaisse avant que ça explose !` });
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

async function crashClick(interaction, game) {
  const m = growth(Date.now() - game.startedAt);
  if (m >= game.crashAt) finish(game, 0);
  else {
    game.cashedAt = m;
    finish(game, payout(game.bet, m));
  }
  game.last = interaction;
  return interaction.update(game.view());
}

// --- .course <mise> <cheval> : 5 chevaux, le premier à l'arrivée gagne (mise ×4,75) ---
export const HORSES = ['Éclair', 'Tonnerre', 'Comète', 'Tornade', 'Mistral'];
export const RACE_PAYS = 4.75;
const FINISH = 20;
const LANE = 12;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function startRace(interaction, bet, horse) {
  const { guild, user } = interaction;
  const key = `co:${newGameId()}`;
  holdBet(guild.id, key, user.id, bet);
  // Toute la course est tirée d'avance, puis montrée en quelques étapes.
  const frames = [];
  const pos = HORSES.map(() => 0);
  while (Math.max(...pos) < FINISH) {
    for (let i = 0; i < pos.length; i++) pos[i] += 1 + Math.floor(Math.random() * 3);
    frames.push([...pos]);
  }
  const best = Math.max(...pos);
  const leaders = pos.map((p, i) => (p === best ? i : -1)).filter((i) => i >= 0);
  const winner = leaders[Math.floor(Math.random() * leaders.length)];
  const lanes = (p, done) =>
    HORSES.map((h, i) => {
      const at = Math.min(LANE, Math.round((Math.min(p[i], FINISH) / FINISH) * LANE));
      return `${i + 1}. ${'▬'.repeat(at)}🏇${'·'.repeat(LANE - at)}🏁 ${done && i === winner ? `**${h} 🏆**` : h}${i === horse ? ' ⬅️' : ''}`;
    }).join('\n');
  const head = `🪙 Mise : **${formatMoney(bet)}** sur **${horse + 1}. ${HORSES[horse]}** (gain ×${RACE_PAYS.toLocaleString('fr-FR')})`;
  const embed = (p, text, color = 0xe67e22) => new EmbedBuilder().setColor(color).setTitle('🏇 Course de chevaux').setDescription(`${head}\n\n${lanes(p, Boolean(text))}${text ? `\n\n${text}` : ''}`);
  await interaction.reply({ embeds: [embed(HORSES.map(() => 0))], allowedMentions: { parse: [] } });
  for (const step of [0.25, 0.5, 0.75]) {
    await sleep(1300);
    await interaction.editReply({ embeds: [embed(frames[Math.floor(frames.length * step)])] }).catch(() => {});
  }
  await sleep(1300);
  const won = winner === horse;
  const pocket = settleHold(guild.id, key, won ? payout(bet, RACE_PAYS) : 0);
  const text = won
    ? `✅ **${HORSES[winner]} gagne !** 🪙 **+${formatMoney(payout(bet, RACE_PAYS) - bet)}**`
    : `❌ **${HORSES[winner]} gagne…** 🪙 **-${formatMoney(bet)}**`;
  await interaction
    .editReply({
      embeds: [embed(frames.at(-1), text, won ? 0x2ecc71 : 0xe74c3c).setFooter({ text: `${name(user)} · Poche : ${formatMoney(pocket)}` })],
      components: [againRow(user.id, 'co', bet, String(horse))],
    })
    .catch(() => {});
}

// --- .gratter <mise> : ticket à gratter de 9 cases ; 3 symboles identiques = gain (≈ 96 % reversés) ---
export const SCRATCH = [
  { s: '👑', pays: 100, p: 0.001 },
  { s: '💎', pays: 20, p: 0.008 },
  { s: '🔔', pays: 5, p: 0.05 },
  { s: '🍒', pays: 2, p: 0.12 },
  { s: '🍀', pays: 1, p: 0.21 },
];
const SCRATCH_CELLS = 9;
const scratchPays = SCRATCH.map((x) => `${x.s} ${x.pays === 1 ? 'mise rendue' : `×${x.pays}`}`).join(' · ');

// Le gain est tiré d'abord, puis le ticket est rempli en conséquence : le symbole gagnant 3 fois,
// les autres 2 fois au plus (un seul trio possible).
function scratchTicket() {
  let roll = Math.random();
  let win = null;
  for (const x of SCRATCH) {
    if ((roll -= x.p) < 0) {
      win = x;
      break;
    }
  }
  const cells = win ? [win.s, win.s, win.s] : [];
  while (cells.length < SCRATCH_CELLS) {
    const s = SCRATCH[Math.floor(Math.random() * SCRATCH.length)].s;
    if (s !== win?.s && cells.filter((c) => c === s).length < 2) cells.push(s);
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return { cells, win };
}

export async function startScratch(interaction, bet) {
  const game = newGame(interaction, 'gr', bet, { ...scratchTicket(), shown: new Set() });
  game.view = () => scratchView(game);
  await interaction.reply(game.view());
  arm(game, () => scratchEnd(game));
}

function scratchEnd(game) {
  for (let i = 0; i < SCRATCH_CELLS; i++) game.shown.add(i);
  finish(game, game.win ? payout(game.bet, game.win.pays) : 0);
}

function scratchView(game) {
  const lines = [`🪙 Mise : **${formatMoney(game.bet)}**`, `Trois identiques : ${scratchPays}`, ''];
  let color = 0xc9a227;
  if (!game.done) {
    lines.push(game.shown.size ? `Encore **${SCRATCH_CELLS - game.shown.size}** case(s) à gratter.` : 'Gratte les cases : trois symboles identiques et c’est gagné !');
  } else if (!game.win) {
    color = 0xe74c3c;
    lines.push(`❌ **Perdu…** Aucun symbole trois fois. 🪙 **-${formatMoney(game.bet)}**`);
  } else if (game.win.pays === 1) {
    color = 0x95a5a6;
    lines.push(`${game.win.s} **Trois trèfles** : ta mise est rendue.`);
  } else {
    color = 0x2ecc71;
    lines.push(`🎉 **Trois ${game.win.s} !** (×${game.win.pays}) 🪙 **+${formatMoney(game.payout - game.bet)}**`);
  }
  const rows = [0, 1, 2].map((r) =>
    new ActionRowBuilder().addComponents(
      [0, 1, 2].map((c) => {
        const i = r * 3 + c;
        const btn = new ButtonBuilder().setCustomId(`cas_gr:${game.id}:${i}`).setDisabled(game.done || game.shown.has(i));
        if (!game.shown.has(i)) return btn.setEmoji('❔').setStyle(ButtonStyle.Secondary);
        const winning = game.done && game.cells[i] === game.win?.s;
        return btn.setEmoji(game.cells[i]).setStyle(winning ? ButtonStyle.Success : ButtonStyle.Secondary);
      }),
    ),
  );
  rows.push(
    game.done
      ? againRow(game.userId, 'gr', game.bet)
      : new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`cas_gr:${game.id}:all`).setLabel('Tout gratter').setEmoji('🪙').setStyle(ButtonStyle.Primary)),
  );
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('🎟️ Ticket à gratter')
    .setDescription(lines.join('\n'))
    .setFooter({ text: game.done ? `${game.name} · Poche : ${formatMoney(game.pocket)}` : `${game.name} · sans clic pendant 60 s, tout est gratté` });
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

async function scratchClick(interaction, game, value) {
  if (value === 'all') scratchEnd(game);
  else {
    const i = Number(value);
    if (game.shown.has(i)) return interaction.deferUpdate();
    game.shown.add(i);
    if (game.shown.size === SCRATCH_CELLS) scratchEnd(game);
    else arm(game, () => scratchEnd(game));
  }
  game.last = interaction;
  return interaction.update(game.view());
}

// --- .tour <mise> [niveau] : 8 étages ; à chaque étage, une porte cache un piège. Encaisse quand tu veux ---
export const TOWER_FLOORS = 8;
export const TOWER_LEVELS = {
  facile: { label: 'Facile', doors: 4, traps: 1 },
  moyen: { label: 'Moyen', doors: 3, traps: 1 },
  difficile: { label: 'Difficile', doors: 2, traps: 1 },
};
export const towerMult = (floors, lvl) => round2(EDGE * (lvl.doors / (lvl.doors - lvl.traps)) ** floors);

export async function startTower(interaction, bet, level = 'moyen') {
  const lvl = TOWER_LEVELS[level] ?? TOWER_LEVELS.moyen;
  const traps = Array.from({ length: TOWER_FLOORS }, () => {
    const set = new Set();
    while (set.size < lvl.traps) set.add(Math.floor(Math.random() * lvl.doors));
    return set;
  });
  const game = newGame(interaction, 'to', bet, { level: TOWER_LEVELS[level] ? level : 'moyen', lvl, traps, floor: 0, picks: [], lost: false });
  game.view = () => towerView(game);
  await interaction.reply(game.view());
  arm(game, () => towerCash(game));
}

// Sans étage passé, la mise est rendue.
const towerCash = (game) => finish(game, game.floor ? payout(game.bet, towerMult(game.floor, game.lvl)) : game.bet);

function towerView(game) {
  const { lvl, floor } = game;
  const lines = [`🪙 Mise : **${formatMoney(game.bet)}** · niveau **${lvl.label}** (${lvl.doors} portes, ${lvl.traps} piège par étage)`, ''];
  for (let f = TOWER_FLOORS - 1; f >= 0; f--) {
    const cells = Array.from({ length: lvl.doors }, (_, d) => {
      const trap = game.traps[f].has(d);
      if (f === floor && !game.done) return '🟦';
      if (f === floor && game.lost) return game.picks[f] === d ? '💥' : trap ? '💀' : '⬛';
      if (f < floor && game.picks[f] === d) return '🟩';
      return game.done && trap ? '💀' : '⬛';
    });
    lines.push(`${cells.join('')}  ${mult(towerMult(f + 1, lvl))}${f === floor && !game.done ? ' ⬅️' : ''}`);
  }
  lines.push('');
  const now = towerMult(floor, lvl);
  let color = 0x2b2d31;
  if (!game.done) {
    lines.push(floor ? `💰 Étage **${floor}** : ${mult(now)} → 🪙 **${formatMoney(payout(game.bet, now))}**` : 'Choisis une porte pour monter. Évite le piège 💀 !');
  } else if (game.lost) {
    color = 0xe74c3c;
    lines.push(`💀 **Piège !** Tu tombes de la tour. 🪙 **-${formatMoney(game.bet)}**`);
  } else if (!floor) {
    color = 0x95a5a6;
    lines.push('⌛ Pas d’étage passé : ta mise est rendue.');
  } else {
    color = 0x2ecc71;
    lines.push(`${floor === TOWER_FLOORS ? '🏆 **Sommet atteint !**' : `💰 **Encaissé à l’étage ${floor}**`} (${mult(now)}) 🪙 **+${formatMoney(game.payout - game.bet)}**`);
  }
  const components = game.done
    ? [againRow(game.userId, 'to', game.bet, game.level)]
    : [
        new ActionRowBuilder().addComponents(
          Array.from({ length: lvl.doors }, (_, d) =>
            new ButtonBuilder().setCustomId(`cas_to:${game.id}:${d}`).setLabel(`Porte ${d + 1}`).setEmoji('🚪').setStyle(ButtonStyle.Secondary),
          ),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`cas_to:${game.id}:cash`)
            .setLabel(floor ? `Encaisser ${mult(now)} (${formatMoney(payout(game.bet, now))})` : 'Encaisser')
            .setEmoji('💰')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(!floor),
        ),
      ];
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('🗼 La tour')
    .setDescription(lines.join('\n'))
    .setFooter({ text: game.done ? `${game.name} · Poche : ${formatMoney(game.pocket)}` : `${game.name} · 60 s par étage, sinon encaissement automatique` });
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

async function towerClick(interaction, game, value) {
  if (value === 'cash') {
    if (!game.floor) return interaction.deferUpdate();
    towerCash(game);
  } else {
    const d = Number(value);
    game.picks[game.floor] = d;
    if (game.traps[game.floor].has(d)) {
      game.lost = true;
      finish(game, 0);
    } else {
      game.floor++;
      if (game.floor === TOWER_FLOORS) towerCash(game);
      else arm(game, () => towerCash(game));
    }
  }
  game.last = interaction;
  return interaction.update(game.view());
}

// --- .plinko <mise> [risque] : la bille rebondit sur 8 rangées de clous et tombe dans une des 9 cases ---
// Les cases du bord rapportent gros, celles du centre moins que la mise (≈ 96-97 % reversés).
export const PLINKO_ROWS = 8;
export const PLINKO_RISKS = {
  faible: { label: 'Faible', half: [5.5, 2, 1.2, 0.9, 0.5] },
  moyen: { label: 'Moyen', half: [13, 3, 1.4, 0.6, 0.4] },
  eleve: { label: 'Élevé', half: [29, 4, 1.4, 0.3, 0.2] },
};
export const plinkoSlots = (risk) => [...risk.half, ...risk.half.slice(0, -1).reverse()];
const slotText = (m) => `×${m.toLocaleString('fr-FR')}`;

// Le plateau en triangle, avec la bille après `upto` rebonds (dans les cases quand upto = PLINKO_ROWS).
function plinkoBoard(path, upto) {
  const at = path.slice(0, upto).reduce((n, step) => n + step, 0);
  const lines = [];
  for (let row = 0; row <= PLINKO_ROWS; row++) {
    const cells = Array.from({ length: row + 1 }, (_, j) => (row === upto && j === at ? '●' : row === PLINKO_ROWS ? '_' : '·'));
    lines.push(' '.repeat(PLINKO_ROWS - row) + cells.join(' '));
  }
  return `\`\`\`\n${lines.join('\n')}\n\`\`\``;
}

export async function playPlinko(interaction, bet, riskKey = 'moyen') {
  const { guild, user } = interaction;
  const key = PLINKO_RISKS[riskKey] ? riskKey : 'moyen';
  const risk = PLINKO_RISKS[key];
  const slots = plinkoSlots(risk);
  const hold = `pk:${newGameId()}`;
  holdBet(guild.id, hold, user.id, bet);
  const path = Array.from({ length: PLINKO_ROWS }, () => (Math.random() < 0.5 ? 0 : 1));
  const slot = path.reduce((n, step) => n + step, 0);
  const win = payout(bet, slots[slot]);
  const head = `🪙 Mise : **${formatMoney(bet)}** · risque **${risk.label}**`;
  const slotLine = (final) => slots.map((m, j) => (final && j === slot ? `**[${slotText(m)}]**` : slotText(m))).join(' ');
  const embed = (upto, text, color = 0x9b59b6) =>
    new EmbedBuilder()
      .setColor(color)
      .setTitle('🔴 Plinko')
      .setDescription(`${head}\n${plinkoBoard(path, upto)}${slotLine(Boolean(text))}${text ? `\n\n${text}` : ''}`);
  await interaction.reply({ embeds: [embed(0)], allowedMentions: { parse: [] } });
  for (const upto of [3, 6]) {
    await sleep(900);
    await interaction.editReply({ embeds: [embed(upto)] }).catch(() => {});
  }
  await sleep(900);
  const pocket = settleHold(guild.id, hold, win);
  const delta = win - bet;
  const text =
    delta > 0
      ? `✅ **${slotText(slots[slot])}** 🪙 **+${formatMoney(delta)}**`
      : delta === 0
        ? `➖ **${slotText(slots[slot])}** : ta mise est rendue.`
        : `❌ **${slotText(slots[slot])}** 🪙 **-${formatMoney(-delta)}**`;
  await interaction
    .editReply({
      embeds: [embed(PLINKO_ROWS, text, delta > 0 ? 0x2ecc71 : delta === 0 ? 0x95a5a6 : 0xe74c3c).setFooter({ text: `${name(user)} · Poche : ${formatMoney(pocket)}` })],
      components: [againRow(user.id, 'pk', bet, key)],
    })
    .catch(() => {});
}

// --- .braquage : braquage de la banque centrale à plusieurs (60 s pour rejoindre, 2 participants minimum) ---
const HEIST_JOIN_MS = 60_000;
const HEIST_COOLDOWN = 3 * 3_600_000;
const HEIST_MIN = 200; // en poche, pour participer (de quoi payer l'amende)
export const heistChance = (n) => Math.min(0.8, 0.25 + 0.1 * n);

function heistProblem(guildId, userId) {
  const last = getHeist(guildId, userId).braquage;
  if (last && Date.now() - last < HEIST_COOLDOWN) return `⏳ Tu as déjà fait un braquage. Reviens <t:${Math.floor((last + HEIST_COOLDOWN) / 1000)}:R>.`;
  if (getCoins(guildId, userId) < HEIST_MIN) return `❌ Il faut au moins 🪙 **${HEIST_MIN}** en poche pour participer (en cas d’échec, il y a une amende).`;
  return null;
}

export async function startHeist(interaction) {
  const { guild, user } = interaction;
  if ([...games.values()].some((g) => g.heist && g.guildId === guild.id)) {
    return interaction.reply({ content: '❌ Un braquage se prépare déjà : rejoins-le avec son bouton.', ephemeral: true });
  }
  const problem = heistProblem(guild.id, user.id);
  if (problem) return interaction.reply({ content: problem, ephemeral: true });
  const game = { id: newGameId(), heist: true, guildId: guild.id, members: [user.id], endsAt: Date.now() + HEIST_JOIN_MS };
  games.set(game.id, game);
  game.view = (result = null) => heistView(game, result);
  game.message = await interaction.reply(game.view());
  game.timer = setTimeout(() => runHeist(game).catch((err) => console.error('[braquage]', err)), HEIST_JOIN_MS);
}

function heistView(game, result) {
  const n = game.members.length;
  const embed = new EmbedBuilder()
    .setColor(result ? (result.ok ? 0x2ecc71 : 0xe74c3c) : 0x2b2d31)
    .setTitle('🏦 Braquage de la banque centrale')
    .setDescription(
      result?.text ??
        `<@${game.members[0]}> prépare un braquage ! Rejoins l’équipe avant <t:${Math.floor(game.endsAt / 1000)}:R>.\n\n` +
          `👥 **${n}** braqueur(s) : ${game.members.map((id) => `<@${id}>`).join(', ')}\n🎯 Chances de réussite : **${Math.round(heistChance(n) * 100)} %** (+10 % par braqueur, 80 % max)\n` +
          `-# Il faut 2 braqueurs minimum et 🪙 ${HEIST_MIN} en poche. En cas d’échec, chacun paie une amende.`,
    );
  const components = result
    ? []
    : [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`cas_bq:${game.id}:join`).setLabel('Participer').setEmoji('🔫').setStyle(ButtonStyle.Danger))];
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

async function heistJoin(interaction, game) {
  if (game.members.includes(interaction.user.id)) return interaction.reply({ content: 'Tu fais déjà partie de l’équipe.', ephemeral: true });
  const problem = heistProblem(game.guildId, interaction.user.id);
  if (problem) return interaction.reply({ content: problem, ephemeral: true });
  game.members.push(interaction.user.id);
  return interaction.update(game.view());
}

async function runHeist(game) {
  games.delete(game.id);
  const { guildId, members } = game;
  let result;
  if (members.length < 2) result = { ok: false, text: '😶 Personne n’a rejoint le braquage : il est annulé (2 braqueurs minimum).' };
  else {
    for (const id of members) patchHeist(guildId, id, { braquage: Date.now() });
    const guild = game.message?.guild ?? game.message?.interaction?.guild;
    if (Math.random() < heistChance(members.length)) {
      const lines = [];
      for (const id of members) {
        const member = guild ? await guild.members.fetch(id).catch(() => null) : null;
        const gain = boostedMoney(member, Math.round(rand(200, 600)));
        addCoins(guildId, id, gain);
        lines.push(`<@${id}> : 🪙 **+${formatMoney(gain)}**`);
      }
      result = { ok: true, text: `💰 **Le braquage réussit !** L’équipe repart avec le butin :\n${lines.join('\n')}` };
    } else {
      const lines = members.map((id) => {
        const fine = Math.min(getCoins(guildId, id), Math.max(50, Math.round(getCoins(guildId, id) * rand(0.1, 0.2))));
        addCoins(guildId, id, -fine);
        return `<@${id}> : 🪙 **-${formatMoney(fine)}**`;
      });
      result = { ok: false, text: `🚓 **La police vous attendait !** Chacun paie une amende :\n${lines.join('\n')}` };
    }
  }
  await game.message?.edit?.(game.view(result)).catch(() => {});
}

// Boutons des jeux : cas_mn / cas_hl / cas_cr / cas_gr / cas_to / cas_bq.
export async function handleCasinoGameInteraction(interaction, kind, id, value) {
  const game = games.get(id);
  if (!game) return interaction.reply({ content: '⌛ Cette partie est terminée.', ephemeral: true });
  if (kind === 'cas_bq') return heistJoin(interaction, game);
  if (interaction.user.id !== game.userId) return notYours(interaction, { cas_mn: 'mines', cas_hl: 'hilo', cas_cr: 'crash', cas_gr: 'gratter', cas_to: 'tour' }[kind]);
  if (game.busy) return interaction.deferUpdate().catch(() => {});
  game.busy = true;
  try {
    if (kind === 'cas_mn') return await minesClick(interaction, game, value);
    if (kind === 'cas_hl') return await hiloClick(interaction, game, value);
    if (kind === 'cas_gr') return await scratchClick(interaction, game, value);
    if (kind === 'cas_to') return await towerClick(interaction, game, value);
    return await crashClick(interaction, game);
  } finally {
    game.busy = false;
  }
}
