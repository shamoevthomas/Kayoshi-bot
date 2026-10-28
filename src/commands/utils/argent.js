import { SlashCommandBuilder } from 'discord.js';
import { getMoney, addMoney, getDaily, setDaily } from '../../lib/store.js';
import { formatMoney } from '../../lib/shop.js';
import { countQuestAction, checkQuests } from '../../lib/quests.js';
import { boostedMoney, roleBoost } from '../../lib/levels.js';
import { spinWheel } from '../../lib/wheel.js';
import { showBalance, moveMoney, work, rob, buyShield, SHIELD_PRICE } from '../../lib/economy.js';

// Économie des membres : récompense quotidienne (avec série de jours), dons entre membres, roue de la
// fortune (lib/wheel.js), poche/banque, travail, vols et anti-vol (lib/economy.js). Classements dans /top.
// L'argent se gagne aussi en écrivant et en passant des niveaux, et se dépense dans /shop.
const DAILY_BASE = 100;
const DAILY_STREAK_BONUS = 10; // en plus par jour de série
const DAILY_MAX = 200;
const DAY = 86_400_000;

export default {
  data: new SlashCommandBuilder()
    .setName('argent')
    .setDescription('Solde, banque, daily, travail, vols, anti-vol, roue de la fortune et dons entre membres.')
    .addSubcommand((s) =>
      s
        .setName('solde')
        .setDescription('Voir ton argent (poche et banque) ou celui d’un membre.')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre (toi par défaut)')),
    )
    .addSubcommand((s) => s.setName('daily').setDescription('Récupérer ta récompense quotidienne (bonus si tu reviens chaque jour).'))
    .addSubcommand((s) =>
      s
        .setName('donner')
        .setDescription('Donner de ton argent à un autre membre.')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre à qui donner').setRequired(true))
        .addIntegerOption((o) => o.setName('montant').setDescription('Combien donner').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) => s.setName('roue').setDescription('Tourner la roue de la fortune (une fois par jour) : argent, XP, booster… ou rien.'))
    .addSubcommand((s) => s.setName('travail').setDescription('Travailler pour gagner de l’argent (une fois par heure).'))
    .addSubcommand((s) =>
      s
        .setName('voler')
        .setDescription('Tenter de voler l’argent en poche d’un membre (une fois par heure, amende si tu échoues).')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre à voler').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('deposer')
        .setDescription('Mettre de l’argent à la banque, à l’abri des vols.')
        .addStringOption((o) => o.setName('montant').setDescription('Ex : 500, 2k, moitié (tout par défaut)')),
    )
    .addSubcommand((s) =>
      s
        .setName('retirer')
        .setDescription('Reprendre de l’argent de la banque dans ta poche.')
        .addStringOption((o) => o.setName('montant').setDescription('Ex : 500, 2k, moitié (tout par défaut)')),
    )
    .addSubcommand((s) => s.setName('antivol').setDescription(`Acheter 12 h de protection contre les vols (💰 ${SHIELD_PRICE}).`))
    .setDMPermission(false),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'daily') return daily(interaction);
    if (sub === 'donner') return give(interaction);
    if (sub === 'solde') return showBalance(interaction);
    if (sub === 'travail') return work(interaction);
    if (sub === 'voler') return rob(interaction);
    if (sub === 'deposer') return moveMoney(interaction, true);
    if (sub === 'retirer') return moveMoney(interaction, false);
    if (sub === 'antivol') return buyShield(interaction);
    return spinWheel(interaction);
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
  const base = Math.min(DAILY_BASE + DAILY_STREAK_BONUS * (streak - 1), DAILY_MAX);
  const gain = boostedMoney(interaction.member, base); // rôle boosté (/boostrole)
  const boost = roleBoost(interaction.member, 'money');
  setDaily(guild.id, user.id, { last: now, streak });
  const balance = addMoney(guild.id, user.id, gain);
  const series = streak > 1 ? ` (série de **${streak}** jours 🔥)` : '';
  const boostNote = boost > 1 ? ` (bonus de rôle ×${boost.toLocaleString('fr-FR')})` : '';
  const hint = base < DAILY_MAX ? 'Reviens demain : +10 par jour de série, jusqu’à 200.' : 'Bonus de série au maximum, garde le rythme !';
  await interaction.reply({
    content: `🎁 ${user} récupère son daily : 💰 **+${formatMoney(gain)}**${boostNote}${series}. Poche : 💰 **${formatMoney(balance)}**.\n-# ${hint}`,
    allowedMentions: { parse: [] },
  });
  countQuestAction(guild.id, user.id, 'daily');
  await checkQuests({ guild, author: user, member: interaction.member, channel: interaction.channel });
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
    return interaction.reply({ content: `❌ Tu n’as que 💰 **${formatMoney(balance)}** en poche.`, ephemeral: true });
  }
  addMoney(guild.id, user.id, -amount);
  addMoney(guild.id, target.id, amount);
  return interaction.reply({
    content: `💸 ${user} a donné 💰 **${formatMoney(amount)}** à ${target} !`,
    allowedMentions: { users: [target.id] },
  });
}
