import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { newDeck, cardText, renderPoker } from './cards.js';
import { holdBet, settleHold, againRow, newGameId } from './bets.js';
import { formatMoney } from './shop.js';

// Poker (/casino poker), en vidéo-poker : 5 cartes, on choisit celles à garder, les autres sont remplacées
// une fois, puis la main finale paie selon HANDS (mise ×1 = rendue). Boutons cas_vp:<partie>:<h:i|draw> ;
// sans action pendant 60 s, les cartes sont tirées avec celles déjà gardées.
const TURN_MS = 60_000;
const games = new Map();

export const HANDS = [
  { name: 'Quinte flush royale', pays: 250 },
  { name: 'Quinte flush', pays: 50 },
  { name: 'Carré', pays: 25 },
  { name: 'Full', pays: 9 },
  { name: 'Couleur', pays: 6 },
  { name: 'Suite', pays: 4 },
  { name: 'Brelan', pays: 3 },
  { name: 'Double paire', pays: 2 },
  { name: 'Paire de valets ou mieux', pays: 1 },
];
const hand = (name) => HANDS.find((h) => h.name === name);
const VALUE = { A: 14, R: 13, D: 12, V: 11 };

// Meilleure combinaison de 5 cartes, ou null.
export function evaluate(cards) {
  const vals = cards.map((c) => VALUE[c.rank] ?? Number(c.rank)).sort((a, b) => a - b);
  const byValue = new Map();
  for (const v of vals) byValue.set(v, (byValue.get(v) ?? 0) + 1);
  const counts = [...byValue.values()].sort((a, b) => b - a);
  const flush = cards.every((c) => c.suit === cards[0].suit);
  const straight = byValue.size === 5 && (vals[4] - vals[0] === 4 || vals.join() === '2,3,4,5,14');
  if (straight && flush) return hand(vals[0] === 10 ? 'Quinte flush royale' : 'Quinte flush');
  if (counts[0] === 4) return hand('Carré');
  if (counts[0] === 3 && counts[1] === 2) return hand('Full');
  if (flush) return hand('Couleur');
  if (straight) return hand('Suite');
  if (counts[0] === 3) return hand('Brelan');
  if (counts[0] === 2 && counts[1] === 2) return hand('Double paire');
  if (counts[0] === 2 && [...byValue].some(([v, n]) => n === 2 && v >= 11)) return hand('Paire de valets ou mieux');
  return null;
}

const holdKey = (game) => `vp:${game.id}`;

export async function startPoker(interaction, bet) {
  const { guild, user } = interaction;
  if ([...games.values()].some((g) => g.userId === user.id)) {
    return interaction.reply({ content: '❌ Tu as déjà une partie de poker en cours : finis-la d’abord.', ephemeral: true });
  }
  const deck = newDeck();
  const game = {
    id: newGameId(),
    guildId: guild.id,
    userId: user.id,
    name: user.displayName ?? user.username,
    bet,
    deck,
    cards: deck.splice(0, 5),
    held: new Set(),
  };
  holdBet(guild.id, holdKey(game), user.id, bet);
  games.set(game.id, game);
  game.last = interaction;
  await interaction.reply(await view(game));
  arm(game);
}

function arm(game) {
  clearTimeout(game.timer);
  game.timer = setTimeout(async () => {
    if (game.done) return;
    game.timedOut = true;
    draw(game);
    await game.last.editReply(await view(game)).catch(() => {});
  }, TURN_MS);
}

function draw(game) {
  clearTimeout(game.timer);
  game.done = true;
  games.delete(game.id);
  game.cards = game.cards.map((c, i) => (game.held.has(i) ? c : game.deck.pop()));
  game.result = evaluate(game.cards);
  game.payout = game.result ? game.bet * game.result.pays : 0;
  game.pocket = settleHold(game.guildId, holdKey(game), game.payout);
}

async function view(game) {
  const current = evaluate(game.cards);
  const lines = [`💰 **Mise : ${formatMoney(game.bet)}**`, '', `🃏 ${game.cards.map((c) => `\`${cardText(c)}\``).join(' ')}`];
  let color = 0x2b2d31;
  if (!game.done) {
    lines.push(`Main actuelle : **${current?.name ?? 'rien'}**`, '', 'Clique sur les cartes à **garder**, puis sur **Tirer** : les autres sont remplacées.');
  } else {
    const delta = game.payout - game.bet;
    color = delta > 0 ? 0x2ecc71 : delta === 0 ? 0x95a5a6 : 0xe74c3c;
    lines.push(
      '',
      game.result
        ? `${delta > 0 ? '✅' : '🤝'} **${game.result.name}** (×${game.result.pays})${delta > 0 ? ` 💰 **+${formatMoney(delta)}**` : ' : ta mise est rendue.'}`
        : `❌ **Rien…** 💰 **-${formatMoney(game.bet)}**`,
    );
    if (game.timedOut) lines.push('-# Temps écoulé : les cartes ont été tirées avec celles déjà gardées.');
  }
  lines.push(`-# Gains : ${HANDS.slice().reverse().map((h) => `${h.name.replace(' ou mieux', '+')} ×${h.pays}`).join(' · ')}`);

  const image = await renderPoker(game.cards, game.done ? new Set() : game.held, game.done ? (game.result?.name ?? 'Rien') : (current?.name ?? 'Rien pour l’instant'));
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('🃏 Poker')
    .setDescription(lines.join('\n'))
    .setImage('attachment://poker.png')
    .setFooter({ text: game.done ? `${game.name} · Poche : ${formatMoney(game.pocket)}` : `${game.name} · Tu as 60 secondes pour jouer` });

  const components = game.done
    ? [againRow(game.userId, 'vp', game.bet)]
    : [
        new ActionRowBuilder().addComponents(
          game.cards.map((c, i) =>
            new ButtonBuilder()
              .setCustomId(`cas_vp:${game.id}:h:${i}`)
              .setLabel(game.held.has(i) ? `${cardText(c)} ✓` : cardText(c))
              .setStyle(game.held.has(i) ? ButtonStyle.Success : ButtonStyle.Secondary),
          ),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`cas_vp:${game.id}:draw`).setLabel('Tirer').setEmoji('🔄').setStyle(ButtonStyle.Primary),
        ),
      ];
  return { embeds: [embed], files: [image], attachments: [], components, allowedMentions: { parse: [] } };
}

export async function handlePokerButton(interaction, id, action, index) {
  const game = games.get(id);
  if (!game) return interaction.reply({ content: '⌛ Cette partie est terminée.', ephemeral: true });
  if (interaction.user.id !== game.userId) {
    return interaction.reply({ content: '❌ Ce n’est pas ta partie : lance la tienne avec `/casino poker`.', ephemeral: true });
  }
  if (game.busy) return interaction.deferUpdate().catch(() => {});
  game.busy = true;
  try {
    if (action === 'h') {
      const i = Number(index);
      if (game.held.has(i)) game.held.delete(i);
      else game.held.add(i);
      arm(game);
    } else draw(game);
    game.last = interaction;
    await interaction.update(await view(game));
  } finally {
    game.busy = false;
  }
}
