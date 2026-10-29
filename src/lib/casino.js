import { EmbedBuilder } from 'discord.js';
import { checkBet, holdBet, settleHold, againRow, newGameId } from './bets.js';
import { startBlackjack, handleBlackjackButton } from './blackjack.js';
import { startPoker, handlePokerButton, HANDS } from './videopoker.js';
import { startMines, startHilo, startCrash, startRace, handleCasinoGameInteraction } from './casinogames.js';
import { formatMoney } from './shop.js';

// Casino (commandes « . », lib/prefix.js) : on mise l'argent de sa poche. Blackjack et poker (lib/blackjack.js, lib/videopoker.js),
// roulette, machine à sous et pile ou face ici. Boutons « cas_ » routés par interactionCreate.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

// --- Roulette (européenne : 0 à 36) ---
const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const ROULETTE_BETS = {
  rouge: { label: '🔴 Rouge', pays: 2, wins: (n) => RED.has(n) },
  noir: { label: '⚫ Noir', pays: 2, wins: (n) => n > 0 && !RED.has(n) },
  pair: { label: 'Pair', pays: 2, wins: (n) => n > 0 && n % 2 === 0 },
  impair: { label: 'Impair', pays: 2, wins: (n) => n % 2 === 1 },
  '1-18': { label: '1 à 18', pays: 2, wins: (n) => n >= 1 && n <= 18 },
  '19-36': { label: '19 à 36', pays: 2, wins: (n) => n >= 19 },
  '1-12': { label: '1 à 12', pays: 3, wins: (n) => n >= 1 && n <= 12 },
  '13-24': { label: '13 à 24', pays: 3, wins: (n) => n >= 13 && n <= 24 },
  '25-36': { label: '25 à 36', pays: 3, wins: (n) => n >= 25 },
  numero: { label: 'Numéro', pays: 36 },
};
const pocketColor = (n) => (n === 0 ? '🟢' : RED.has(n) ? '🔴' : '⚫');
const spinLine = () => Array.from({ length: 5 }, () => Math.floor(Math.random() * 37)).map((n) => `${pocketColor(n)} ${n}`).join('  ');

// option = « rouge », « 1-12 »… ou « n17 » pour un numéro.
async function playRoulette(interaction, bet, option) {
  const { guild, user } = interaction;
  const number = option.startsWith('n') ? Number(option.slice(1)) : null;
  const kind = number === null ? ROULETTE_BETS[option] : ROULETTE_BETS.numero;
  const label = number === null ? kind.label : `Numéro ${pocketColor(number)} ${number}`;
  const key = `rl:${newGameId()}`;
  holdBet(guild.id, key, user.id, bet);
  const result = Math.floor(Math.random() * 37);
  const won = number === null ? kind.wins(result) : result === number;
  const payout = won ? bet * kind.pays : 0;

  const head = `🎡 **Roulette** — ${user}\n🪙 Mise : **${formatMoney(bet)}** sur **${label}**`;
  await interaction.reply({ content: `${head}\n\nLa bille tourne… ${spinLine()}`, allowedMentions: { parse: [] } });
  await sleep(1300);
  await interaction.editReply(`${head}\n\nElle ralentit… ${spinLine()}`).catch(() => {});
  await sleep(1300);
  const pocket = settleHold(guild.id, key, payout);
  const tags = result === 0 ? 'zéro' : [RED.has(result) ? 'rouge' : 'noir', result % 2 ? 'impair' : 'pair'].join(', ');
  const embed = new EmbedBuilder()
    .setColor(won ? 0x2ecc71 : 0xe74c3c)
    .setTitle('🎡 Roulette')
    .setDescription(
      `🪙 Mise : **${formatMoney(bet)}** sur **${label}**\n\nLa bille s’arrête sur ${pocketColor(result)} **${result}** _(${tags})_\n\n` +
        (won ? `✅ **Gagné !** (×${kind.pays}) 🪙 **+${formatMoney(payout - bet)}**` : `❌ **Perdu…** 🪙 **-${formatMoney(bet)}**`),
    )
    .setFooter({ text: `${user.displayName ?? user.username} · Poche : ${formatMoney(pocket)}` });
  await interaction.editReply({ content: '', embeds: [embed], components: [againRow(user.id, 'rl', bet, option)] }).catch(() => {});
}

// --- Machine à sous : 3 rouleaux. 3 identiques = gros gain, 2 identiques = mise ×1,2 (≈ 96 % reversés). ---
const SYMBOLS = [
  { s: '🍒', weight: 7, pays: 5 },
  { s: '🍋', weight: 6, pays: 8 },
  { s: '🍇', weight: 5, pays: 12 },
  { s: '🔔', weight: 3, pays: 25 },
  { s: '⭐', weight: 2, pays: 50 },
  { s: '💎', weight: 1.2, pays: 100 },
  { s: '7️⃣', weight: 0.8, pays: 200 },
];
export const SLOT_PAIR = 1.2;
const TOTAL_WEIGHT = SYMBOLS.reduce((n, x) => n + x.weight, 0);
function reel() {
  let roll = Math.random() * TOTAL_WEIGHT;
  for (const x of SYMBOLS) if ((roll -= x.weight) < 0) return x;
  return SYMBOLS[0];
}
const reels = (r) => `┃ ${r.map((x) => x.s).join(' ┃ ')} ┃`;

async function playSlots(interaction, bet) {
  const { guild, user } = interaction;
  const key = `sl:${newGameId()}`;
  holdBet(guild.id, key, user.id, bet);
  const result = [reel(), reel(), reel()];
  const [a, b, c] = result;
  const three = a.s === b.s && b.s === c.s;
  const pair = !three && (a.s === b.s || b.s === c.s || a.s === c.s);
  const payout = three ? bet * a.pays : pair ? Math.floor(bet * SLOT_PAIR) : 0;

  const head = `🎰 **Machine à sous** — ${user} · 🪙 Mise : **${formatMoney(bet)}**`;
  const random = () => [pick(SYMBOLS), pick(SYMBOLS), pick(SYMBOLS)];
  await interaction.reply({ content: `${head}\n# ${reels(random())}`, allowedMentions: { parse: [] } });
  await sleep(900);
  await interaction.editReply(`${head}\n# ${reels([a, pick(SYMBOLS), pick(SYMBOLS)])}`).catch(() => {});
  await sleep(900);
  await interaction.editReply(`${head}\n# ${reels([a, b, pick(SYMBOLS)])}`).catch(() => {});
  await sleep(900);
  const pocket = settleHold(guild.id, key, payout);
  const delta = payout - bet;
  const verdict = three
    ? `${a.s === '7️⃣' ? '🎉 **JACKPOT !!!**' : '🎉 **Trois identiques !**'} (×${a.pays}) 🪙 **+${formatMoney(delta)}**`
    : pair
      ? `✨ **Deux identiques** (×${SLOT_PAIR.toLocaleString('fr-FR')}) 🪙 **+${formatMoney(delta)}**`
      : `❌ **Perdu…** 🪙 **-${formatMoney(bet)}**`;
  await interaction
    .editReply({
      content: `${head}\n# ${reels(result)}\n${verdict}\n-# Poche : 🪙 ${formatMoney(pocket)}`,
      components: [againRow(user.id, 'sl', bet)],
    })
    .catch(() => {});
}

// --- Pile ou face : mise ×2 ---
async function playCoinFlip(interaction, bet, choice) {
  const { guild, user } = interaction;
  const key = `pf:${newGameId()}`;
  holdBet(guild.id, key, user.id, bet);
  const result = Math.random() < 0.5 ? 'pile' : 'face';
  const won = result === choice;
  const head = `🪙 **Pile ou face** — ${user} · 🪙 **${formatMoney(bet)}** sur **${choice}**`;
  await interaction.reply({ content: `${head}\n\nLa pièce tourne… 🪙`, allowedMentions: { parse: [] } });
  await sleep(1500);
  const pocket = settleHold(guild.id, key, won ? bet * 2 : 0);
  await interaction
    .editReply({
      content:
        `${head}\n\nC’est **${result.toUpperCase()}** !\n` +
        `${won ? `✅ **Gagné !** 🪙 **+${formatMoney(bet)}**` : `❌ **Perdu…** 🪙 **-${formatMoney(bet)}**`}\n-# Poche : 🪙 ${formatMoney(pocket)}`,
      components: [againRow(user.id, 'pf', bet, choice)],
    })
    .catch(() => {});
}

// Lance un jeu (commande .bj, .roulette… ou bouton « Rejouer »). La mise a déjà été lue mais pas vérifiée.
export async function playGame(interaction, game, raw, option = '') {
  const { bet, error } = checkBet(interaction.guild.id, interaction.user.id, raw);
  if (error) return interaction.reply({ content: error, ephemeral: true });
  if (game === 'bj') return startBlackjack(interaction, bet);
  if (game === 'vp') return startPoker(interaction, bet);
  if (game === 'rl') return playRoulette(interaction, bet, option);
  if (game === 'sl') return playSlots(interaction, bet);
  if (game === 'pf') return playCoinFlip(interaction, bet, option);
  if (game === 'mn') return startMines(interaction, bet, Number(option) || 3);
  if (game === 'hl') return startHilo(interaction, bet);
  if (game === 'cr') return startCrash(interaction, bet, Number(option) || null);
  if (game === 'co') return startRace(interaction, bet, Number(option) || 0);
}

// Règles de chaque jeu, affichées par « .help bj », « .help roulette »…
export const GAME_RULES = {
  bj:
    'Le but : s’approcher de **21** sans le dépasser, et faire mieux que le croupier. Les cartes de 2 à 10 valent leur chiffre, ' +
    'V, D et R valent 10, l’as vaut 1 ou 11. **Tirer** = une carte de plus, **Rester** = garder sa main, **Doubler** = doubler la mise ' +
    'et recevoir une seule carte. Le croupier tire jusqu’à 17.\nGagné : mise ×2 · Blackjack d’entrée (as + 10/figure) : ×2,5 · Égalité : mise rendue.',
  vp:
    '5 cartes : choisis celles à garder, les autres sont remplacées une fois. Gains selon la main finale : ' +
    HANDS.slice().reverse().map((h) => `${h.name} ×${h.pays}`).join(' · ') +
    '.',
  rl: 'Numéros de 0 à 36. Rouge, noir, pair, impair, 1-18 ou 19-36 : ×2 · Douzaine (1-12, 13-24, 25-36) : ×3 · Numéro précis : ×36. Le 0 (vert) fait perdre les autres paris.',
  sl: `Trois rouleaux. Trois identiques : ${SYMBOLS.map((x) => `${x.s} ×${x.pays}`).join(' · ')}. Deux identiques : ×${SLOT_PAIR.toLocaleString('fr-FR')}.`,
  pf: 'Une chance sur deux : mise ×2.',
};

// Boutons cas_bj:…, cas_vp:…, cas_again:<joueur>:<jeu>:<mise>:<option>.
export async function handleCasinoInteraction(interaction) {
  const [kind, ...rest] = interaction.customId.split(':');
  if (kind === 'cas_bj') return handleBlackjackButton(interaction, rest[0], rest[1]);
  if (kind === 'cas_vp') return handlePokerButton(interaction, rest[0], rest[1], rest[2]);
  if (['cas_mn', 'cas_hl', 'cas_cr', 'cas_bq'].includes(kind)) return handleCasinoGameInteraction(interaction, kind, rest[0], rest[1]);
  if (kind === 'cas_again') {
    const [userId, game, bet, option] = rest;
    if (interaction.user.id !== userId) {
      return interaction.reply({ content: '❌ Ce bouton est pour le joueur de cette partie : lance la tienne avec `.help` pour voir les jeux.', ephemeral: true });
    }
    const { error } = checkBet(interaction.guild.id, userId, bet);
    if (error) return interaction.reply({ content: error, ephemeral: true });
    // Le bouton ne sert qu'une fois (le message garde son résultat).
    await interaction.message.edit({ components: [] }).catch(() => {});
    return playGame(interaction, game, bet, option);
  }
}
