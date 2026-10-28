import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { getMoney, addMoney, getBank, getCasinoHolds, setCasinoHold } from './store.js';
import { parseAmount } from './economy.js';
import { formatMoney } from './shop.js';

// Mises du casino et des duels. Une mise est retirée de la poche dès le début de la partie et notée
// « en jeu » (casinoHolds) jusqu'à la fin : si le bot redémarre en pleine partie, elle est rendue au démarrage.
export const MIN_BET = 10;

// Lit la mise écrite par le membre (« 500 », « 2k », « moitié », « tout »…) et vérifie sa poche.
// Renvoie { bet } ou { error }. À utiliser juste avant holdBet, sans await entre les deux.
export function checkBet(guildId, userId, raw) {
  const pocket = getMoney(guildId, userId);
  const bet = parseAmount(raw, pocket);
  if (bet === null) return { error: '❌ Mise invalide : écris un nombre (ex : `500`, `2k`), `moitié` ou `tout`.' };
  if (bet > pocket || pocket < MIN_BET) {
    const bank = getBank(guildId, userId);
    return {
      error: `❌ Tu n’as que 💰 **${formatMoney(pocket)}** en poche.${bank ? ` Tu as 💰 **${formatMoney(bank)}** à la banque : \`/argent retirer\`.` : ''}`,
    };
  }
  if (bet < MIN_BET) return { error: `❌ La mise minimum est de 💰 **${MIN_BET}**.` };
  return { bet };
}

export async function readBet(interaction, raw) {
  const { bet, error } = checkBet(interaction.guild.id, interaction.user.id, raw);
  if (error) await interaction.reply({ content: error, ephemeral: true });
  return error ? null : bet;
}

export function holdBet(guildId, key, userId, amount) {
  addMoney(guildId, userId, -amount);
  setCasinoHold(guildId, key, { userId, amount, at: Date.now() });
}

// Mise augmentée en cours de partie (doubler au blackjack).
export function raiseHold(guildId, key, extra) {
  const hold = getCasinoHolds(guildId)[key];
  if (!hold) return;
  addMoney(guildId, hold.userId, -extra);
  setCasinoHold(guildId, key, { ...hold, amount: hold.amount + extra });
}

// Fin de partie : la mise n'est plus en jeu, payout (mise comprise, 0 si perdu) va au joueur
// (ou à `to`, ex. le gagnant d'un duel). Renvoie la poche du joueur.
export function settleHold(guildId, key, payout, to = null) {
  const hold = getCasinoHolds(guildId)[key];
  setCasinoHold(guildId, key, null);
  const userId = to ?? hold?.userId;
  if (payout > 0 && userId) addMoney(guildId, userId, payout);
  return hold ? getMoney(guildId, hold.userId) : 0;
}

// Au démarrage : les parties en mémoire sont perdues, on rend les mises qui étaient en jeu.
export function refundHolds(client) {
  for (const guildId of client.guilds.cache.keys()) {
    const holds = getCasinoHolds(guildId);
    for (const [key, hold] of Object.entries(holds)) {
      addMoney(guildId, hold.userId, hold.amount);
      setCasinoHold(guildId, key, null);
    }
    const n = Object.keys(holds).length;
    if (n) console.log(`[casino] ${n} mise(s) rendue(s) après redémarrage (${guildId})`);
  }
}

// Bouton « Rejouer » (même jeu, même mise) : cas_again:<joueur>:<jeu>:<mise>:<option>.
export function againRow(userId, game, bet, option = '') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`cas_again:${userId}:${game}:${bet}:${option}`)
      .setLabel(`Rejouer (${formatMoney(bet)})`)
      .setEmoji('🔁')
      .setStyle(ButtonStyle.Secondary),
  );
}

export const newGameId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
