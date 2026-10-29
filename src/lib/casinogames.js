import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getCoins, addCoins, getHeist, patchHeist } from './store.js';
import { holdBet, settleHold, againRow, newGameId } from './bets.js';
import { formatMoney } from './shop.js';
import { boostedMoney } from './levels.js';

// Jeux du casino (commandes « . ») : .mines, .hilo, .crash, .course et .braquage. Les mises sont prises dans la
// poche (coins) et gardées « en jeu » jusqu'à la fin (lib/bets.js). La banque garde un petit avantage (EDGE).
// Boutons cas_mn:…, cas_hl:…, cas_cr:…, cas_bq:… routés par lib/casino.js.
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

// Boutons des jeux : cas_mn / cas_hl / cas_cr / cas_bq.
export async function handleCasinoGameInteraction(interaction, kind, id, value) {
  const game = games.get(id);
  if (!game) return interaction.reply({ content: '⌛ Cette partie est terminée.', ephemeral: true });
  if (kind === 'cas_bq') return heistJoin(interaction, game);
  if (interaction.user.id !== game.userId) return notYours(interaction, { cas_mn: 'mines', cas_hl: 'hilo', cas_cr: 'crash' }[kind]);
  if (game.busy) return interaction.deferUpdate().catch(() => {});
  game.busy = true;
  try {
    if (kind === 'cas_mn') return await minesClick(interaction, game, value);
    if (kind === 'cas_hl') return await hiloClick(interaction, game, value);
    return await crashClick(interaction, game);
  } finally {
    game.busy = false;
  }
}
