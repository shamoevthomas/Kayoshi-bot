import { EmbedBuilder } from 'discord.js';
import { getCoins, addCoins, getLivret, setLivret, getAllLivrets, getLivretDay, setLivretDay } from './store.js';
import { formatMoney } from './shop.js';
import { parseAmount, KEEP_IN_POCKET } from './economy.js';

// Livret A (.livret) : un compte d'épargne à l'abri des vols, qui rapporte RATE par jour (versés chaque
// nuit après minuit, heure de Paris). Plafond de dépôt PLAFOND (les intérêts peuvent le dépasser).
// .livret : solde + historique des intérêts ; .livret dep <montant|all> ; .livret with <montant|all>.
export const RATE = 0.01;
export const PLAFOND = 25_000;
const HISTORY = 10;
const parisDay = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' });

export async function livret(interaction) {
  const { guild, user } = interaction;
  const action = (interaction.options.getString('action') ?? '').toLowerCase();
  const raw = interaction.options.getString('montant') ?? 'tout';
  const acc = getLivret(guild.id, user.id);

  if (['dep', 'depot', 'dépôt', 'deposer', 'déposer'].includes(action)) {
    const pocket = getCoins(guild.id, user.id);
    const room = Math.max(0, PLAFOND - acc.amount);
    const max = Math.min(Math.max(0, pocket - KEEP_IN_POCKET), room);
    if (!room) return interaction.reply({ content: `❌ Ton livret est plein (plafond de 🪙 **${formatMoney(PLAFOND)}**).`, ephemeral: true });
    if (!max) return interaction.reply({ content: `❌ Tu dois garder au moins 🪙 **${KEEP_IN_POCKET}** en poche : tu as 🪙 **${formatMoney(pocket)}**.`, ephemeral: true });
    const amount = parseAmount(raw, max);
    if (!amount || amount <= 0) return interaction.reply({ content: '❌ Montant invalide : `.livret dep 500` (ou `all`).', ephemeral: true });
    if (amount > max) {
      return interaction.reply({
        content: `❌ Tu peux déposer au maximum 🪙 **${formatMoney(max)}** (plafond du livret : ${formatMoney(PLAFOND)}, et tu gardes ${KEEP_IN_POCKET} en poche).`,
        ephemeral: true,
      });
    }
    addCoins(guild.id, user.id, -amount);
    setLivret(guild.id, user.id, { ...acc, amount: acc.amount + amount });
    return interaction.reply({
      content: `📘 ${user} place 🪙 **${formatMoney(amount)}** sur son livret A (🪙 ${formatMoney(acc.amount + amount)}).\n-# Rapporte ${RATE * 100} % par jour, versés chaque nuit.`,
      allowedMentions: { parse: [] },
    });
  }

  if (['with', 'retrait', 'retirer'].includes(action)) {
    if (!acc.amount) return interaction.reply({ content: '❌ Ton livret est vide.', ephemeral: true });
    const amount = parseAmount(raw, acc.amount);
    if (!amount || amount <= 0) return interaction.reply({ content: '❌ Montant invalide : `.livret with 500` (ou `all`).', ephemeral: true });
    if (amount > acc.amount) return interaction.reply({ content: `❌ Ton livret ne contient que 🪙 **${formatMoney(acc.amount)}**.`, ephemeral: true });
    setLivret(guild.id, user.id, { ...acc, amount: acc.amount - amount });
    addCoins(guild.id, user.id, amount);
    return interaction.reply({ content: `👛 ${user} retire 🪙 **${formatMoney(amount)}** de son livret A (reste 🪙 ${formatMoney(acc.amount - amount)}).`, allowedMentions: { parse: [] } });
  }

  // Sans action : solde et historique des intérêts.
  const lines = acc.history.length
    ? acc.history.map((h) => `• <t:${Math.floor(h.at / 1000)}:d> : 🪙 **+${formatMoney(h.amount)}**`).join('\n')
    : '_Pas encore d’intérêts : ils sont versés chaque nuit après minuit._';
  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle(`📘 Livret A de ${user.displayName ?? user.username}`)
    .setDescription(`**Solde :** 🪙 ${formatMoney(acc.amount)} / ${formatMoney(PLAFOND)}\n**Taux :** ${RATE * 100} % par jour · à l’abri des vols\n\n**Derniers intérêts**\n${lines}`)
    .setFooter({ text: '.livret dep <montant|all> · .livret with <montant|all>' });
  return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

// Chaque minute : verse les intérêts du jour une fois, après minuit (heure de Paris).
export function livretTick(client) {
  const today = parisDay();
  for (const guild of client.guilds.cache.values()) {
    if (getLivretDay(guild.id) === today) continue;
    const isFirstRun = getLivretDay(guild.id) === null;
    setLivretDay(guild.id, today);
    if (isFirstRun) continue; // premier démarrage : pas d'intérêts « rétroactifs »
    for (const [userId, acc] of Object.entries(getAllLivrets(guild.id))) {
      const interest = Math.floor(acc.amount * RATE);
      if (interest <= 0) continue;
      setLivret(guild.id, userId, { amount: acc.amount + interest, history: [{ at: Date.now(), amount: interest }, ...(acc.history ?? [])].slice(0, HISTORY) });
    }
  }
}
