import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getMoney } from './store.js';
import { newDeck, cardText, renderBlackjack } from './cards.js';
import { holdBet, raiseHold, settleHold, againRow, newGameId } from './bets.js';
import { formatMoney } from './shop.js';

// Blackjack (/casino blackjack) contre le croupier : approcher 21 sans dépasser. Le croupier tire jusqu'à 17.
// Gagné = mise ×2, blackjack d'entrée (as + figure/10) = mise ×2,5, égalité = mise rendue.
// Boutons cas_bj:<partie>:<hit|stand|double> ; sans action pendant 60 s, le joueur reste sur sa main.
const TURN_MS = 60_000;
const games = new Map();

export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const { rank } of cards) {
    if (rank === 'A') {
      aces++;
      total += 11;
    } else total += ['V', 'D', 'R'].includes(rank) ? 10 : Number(rank);
  }
  while (total > 21 && aces--) total -= 10;
  return total;
}

const isBlackjack = (cards) => cards.length === 2 && handValue(cards) === 21;
const holdKey = (game) => `bj:${game.id}`;

export async function startBlackjack(interaction, bet) {
  const { guild, user } = interaction;
  if ([...games.values()].some((g) => g.userId === user.id)) {
    return interaction.reply({ content: '❌ Tu as déjà une partie de blackjack en cours : finis-la d’abord.', ephemeral: true });
  }
  const deck = newDeck();
  const game = {
    id: newGameId(),
    guildId: guild.id,
    userId: user.id,
    name: user.displayName ?? user.username,
    bet,
    deck,
    player: [deck.pop(), deck.pop()],
    dealer: [deck.pop(), deck.pop()],
  };
  holdBet(guild.id, holdKey(game), user.id, bet);
  games.set(game.id, game);
  if (isBlackjack(game.player) || isBlackjack(game.dealer)) finish(game);
  game.last = interaction;
  await interaction.reply(await view(game));
  if (!game.done) arm(game);
}

function arm(game) {
  clearTimeout(game.timer);
  game.timer = setTimeout(async () => {
    if (game.done) return;
    game.timedOut = true;
    finish(game);
    await game.last.editReply(await view(game)).catch(() => {});
  }, TURN_MS);
}

function finish(game) {
  clearTimeout(game.timer);
  game.done = true;
  games.delete(game.id);
  const playerBj = isBlackjack(game.player) && !game.doubled;
  const dealerBj = isBlackjack(game.dealer);
  if (!playerBj && !dealerBj && handValue(game.player) <= 21) {
    while (handValue(game.dealer) < 17) game.dealer.push(game.deck.pop());
  }
  const p = handValue(game.player);
  const d = handValue(game.dealer);
  const { bet } = game;
  let outcome;
  let payout = 0;
  if (playerBj && dealerBj) [outcome, payout] = ['push', bet];
  else if (playerBj) [outcome, payout] = ['blackjack', bet + Math.floor(bet * 1.5)];
  else if (dealerBj) outcome = 'dealerbj';
  else if (p > 21) outcome = 'bust';
  else if (d > 21) [outcome, payout] = ['dealerbust', bet * 2];
  else if (p > d) [outcome, payout] = ['win', bet * 2];
  else if (p === d) [outcome, payout] = ['push', bet];
  else outcome = 'lose';
  game.outcome = outcome;
  game.payout = payout;
  game.pocket = settleHold(game.guildId, holdKey(game), payout);
}

const RESULTS = {
  blackjack: ['🃏 **Blackjack !**', 0xf1c40f],
  win: ['✅ **Gagné !**', 0x2ecc71],
  dealerbust: ['✅ **Le croupier dépasse 21 !**', 0x2ecc71],
  push: ['🤝 **Égalité** : ta mise est rendue.', 0x95a5a6],
  bust: ['💥 **Tu dépasses 21…**', 0xe74c3c],
  dealerbj: ['❌ **Blackjack du croupier…**', 0xe74c3c],
  lose: ['❌ **Perdu…**', 0xe74c3c],
};

async function view(game) {
  const dealerCards = game.done ? game.dealer : [game.dealer[0]];
  const p = handValue(game.player);
  const d = handValue(dealerCards);
  const lines = [
    `💰 **Mise : ${formatMoney(game.bet)}**${game.doubled ? ' _(doublée)_' : ''}`,
    '',
    `🧑 **Ta main** : ${game.player.map((c) => `\`${cardText(c)}\``).join(' ')} — **${p}**`,
    `🤖 **Croupier** : ${dealerCards.map((c) => `\`${cardText(c)}\``).join(' ')}${game.done ? '' : ' `?`'} — **${d}**`,
  ];
  let color = 0x2b2d31;
  if (game.done) {
    const [text, c] = RESULTS[game.outcome];
    color = c;
    const delta = game.payout - game.bet;
    lines.push('', delta > 0 ? `${text} 💰 **+${formatMoney(delta)}**` : delta < 0 ? `${text} 💰 **-${formatMoney(game.bet)}**` : text);
    if (game.timedOut) lines.push('-# Temps écoulé : tu es resté sur ta main.');
  }
  const tag = (cards, total, shown) =>
    shown && isBlackjack(cards) ? ['BLACKJACK', '#ca8a04'] : total > 21 ? ['BUST', '#dc2626'] : [String(total), null];
  const [pTag, pColor] = tag(game.player, p, !game.doubled);
  const [dTag, dColor] = tag(dealerCards, d, game.done);
  const image = await renderBlackjack(
    { label: 'Joueur', cards: game.player, tag: pTag, tagColor: pColor },
    { label: 'Croupier', cards: game.done ? game.dealer : [game.dealer[0], game.dealer[1]], hiddenFrom: game.done ? Infinity : 1, tag: dTag, tagColor: dColor },
  );
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('🃏 Blackjack')
    .setDescription(lines.join('\n'))
    .setImage('attachment://blackjack.png')
    .setFooter({ text: game.done ? `${game.name} · Poche : ${formatMoney(game.pocket)}` : `${game.name} · Tu as 60 secondes pour jouer` });

  let components;
  if (game.done) components = [againRow(game.userId, 'bj', game.bet)];
  else {
    const canDouble = game.player.length === 2 && getMoney(game.guildId, game.userId) >= game.bet;
    components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`cas_bj:${game.id}:hit`).setLabel('Tirer').setEmoji('🃏').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`cas_bj:${game.id}:stand`).setLabel('Rester').setEmoji('✋').setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`cas_bj:${game.id}:double`)
          .setLabel('Doubler')
          .setEmoji('💰')
          .setStyle(ButtonStyle.Danger)
          .setDisabled(!canDouble),
      ),
    ];
  }
  return { embeds: [embed], files: [image], attachments: [], components, allowedMentions: { parse: [] } };
}

export async function handleBlackjackButton(interaction, id, action) {
  const game = games.get(id);
  if (!game) return interaction.reply({ content: '⌛ Cette partie est terminée.', ephemeral: true });
  if (interaction.user.id !== game.userId) {
    return interaction.reply({ content: '❌ Ce n’est pas ta partie : lance la tienne avec `/casino blackjack`.', ephemeral: true });
  }
  if (game.busy) return interaction.deferUpdate().catch(() => {});
  game.busy = true;
  try {
    if (action === 'hit') {
      game.player.push(game.deck.pop());
      if (handValue(game.player) >= 21) finish(game);
    } else if (action === 'double') {
      if (game.player.length !== 2 || getMoney(game.guildId, game.userId) < game.bet) {
        return interaction.reply({ content: `❌ Pour doubler, il te faut encore 💰 **${formatMoney(game.bet)}** en poche.`, ephemeral: true });
      }
      raiseHold(game.guildId, holdKey(game), game.bet);
      game.bet *= 2;
      game.doubled = true;
      game.player.push(game.deck.pop());
      finish(game);
    } else finish(game);
    if (!game.done) arm(game);
    game.last = interaction;
    await interaction.update(await view(game));
  } finally {
    game.busy = false;
  }
}
