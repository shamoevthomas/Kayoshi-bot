import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getMoney, addMoney, getMoneyLeaderboard, getDaily, setDaily } from '../../lib/store.js';
import { formatMoney } from '../../lib/shop.js';

// Économie des membres : récompense quotidienne (avec série de jours), dons entre membres, classement.
// L'argent se gagne aussi en écrivant et en passant des niveaux, et se dépense dans /shop.
const DAILY_BASE = 100;
const DAILY_STREAK_BONUS = 10; // en plus par jour de série
const DAILY_MAX = 200;
const DAY = 86_400_000;
const MEDALS = ['🥇', '🥈', '🥉'];

export default {
  data: new SlashCommandBuilder()
    .setName('argent')
    .setDescription('Récompense quotidienne, dons entre membres et classement de l’argent.')
    .addSubcommand((s) => s.setName('daily').setDescription('Récupérer ta récompense quotidienne (bonus si tu reviens chaque jour).'))
    .addSubcommand((s) =>
      s
        .setName('donner')
        .setDescription('Donner de ton argent à un autre membre.')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre à qui donner').setRequired(true))
        .addIntegerOption((o) => o.setName('montant').setDescription('Combien donner').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) => s.setName('top').setDescription('Classement des membres les plus riches.'))
    .setDMPermission(false),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'daily') return daily(interaction);
    if (sub === 'donner') return give(interaction);
    return top(interaction);
  },
};

// Une fois toutes les 24 h. Série : daily récupéré moins de 48 h après le précédent
// (+10 par jour de série, jusqu'à 200).
async function daily(interaction) {
  const { guild, user } = interaction;
  const now = Date.now();
  const record = getDaily(guild.id, user.id);
  if (record && now - record.last < DAY) {
    return interaction.reply({
      content: `⏳ Tu as déjà récupéré ton daily. Reviens <t:${Math.floor((record.last + DAY) / 1000)}:R>.`,
      ephemeral: true,
    });
  }
  const streak = record && now - record.last < 2 * DAY ? record.streak + 1 : 1;
  const gain = Math.min(DAILY_BASE + DAILY_STREAK_BONUS * (streak - 1), DAILY_MAX);
  setDaily(guild.id, user.id, { last: now, streak });
  const balance = addMoney(guild.id, user.id, gain);
  const series = streak > 1 ? ` (série de **${streak}** jours 🔥)` : '';
  const hint = gain < DAILY_MAX ? 'Reviens demain : +10 par jour de série, jusqu’à 200.' : 'Bonus de série au maximum, garde le rythme !';
  return interaction.reply({
    content: `🎁 ${user} récupère son daily : 💰 **+${formatMoney(gain)}**${series}. Solde : 💰 **${formatMoney(balance)}**.\n-# ${hint}`,
    allowedMentions: { parse: [] },
  });
}

async function give(interaction) {
  const { guild, user } = interaction;
  const target = interaction.options.getMember('membre');
  const amount = interaction.options.getInteger('montant');
  if (!target) return interaction.reply({ content: '❌ Ce membre n’est pas sur le serveur.', ephemeral: true });
  if (target.user.bot) return interaction.reply({ content: '❌ On ne peut pas donner d’argent à un bot.', ephemeral: true });
  if (target.id === user.id) return interaction.reply({ content: '❌ Tu ne peux pas te donner de l’argent à toi-même.', ephemeral: true });

  const balance = getMoney(guild.id, user.id);
  if (balance < amount) {
    return interaction.reply({ content: `❌ Tu n’as que 💰 **${formatMoney(balance)}**.`, ephemeral: true });
  }
  addMoney(guild.id, user.id, -amount);
  addMoney(guild.id, target.id, amount);
  return interaction.reply({
    content: `💸 ${user} a donné 💰 **${formatMoney(amount)}** à ${target} !`,
    allowedMentions: { users: [target.id] },
  });
}

async function top(interaction) {
  const { guild, user } = interaction;
  const board = getMoneyLeaderboard(guild.id);
  const lines = board.length
    ? board
        .slice(0, 10)
        .map((r, i) => `${MEDALS[i] ?? `**${i + 1}.**`} <@${r.userId}> — 💰 **${formatMoney(r.money)}**`)
        .join('\n')
    : '_Personne n’a encore d’argent._';
  const place = board.findIndex((r) => r.userId === user.id);
  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('💰 Classement de l’argent')
    .setDescription(lines)
    .setFooter({ text: place >= 0 ? `Ta place : ${place + 1}ᵉ · ${formatMoney(board[place].money)} 💰` : 'Tu n’as pas encore d’argent' })
    .setTimestamp();
  return interaction.reply({ embeds: [embed] });
}
