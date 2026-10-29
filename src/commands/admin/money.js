import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { addMoney, getMoney, addCoins, getCoins } from '../../lib/store.js';
import { formatMoney } from '../../lib/shop.js';
import { sendLog, Colors } from '../../lib/logger.js';

// Donner ou retirer de l'argent des niveaux (💰, /shop) ou des coins du casino (🪙, commandes « . »).
const CURRENCY = {
  argent: { label: 'Argent', emoji: '💰', get: getMoney, add: addMoney },
  coins: { label: 'Coins', emoji: '🪙', get: getCoins, add: addCoins },
};
const currencyOption = (o) =>
  o
    .setName('monnaie')
    .setDescription('Argent des niveaux (par défaut) ou coins du casino')
    .addChoices({ name: '💰 Argent (niveaux, /shop)', value: 'argent' }, { name: '🪙 Coins (casino)', value: 'coins' });

export default {
  data: new SlashCommandBuilder()
    .setName('money')
    .setDescription('Donner ou retirer de l’argent (niveaux) ou des coins (casino) à un membre.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('ajouter')
        .setDescription('Donner de l’argent ou des coins à un membre.')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
        .addIntegerOption((o) => o.setName('montant').setDescription('Montant à ajouter').setRequired(true).setMinValue(1))
        .addStringOption(currencyOption),
    )
    .addSubcommand((s) =>
      s
        .setName('tous')
        .setDescription('Donner de l’argent ou des coins à tous les membres du serveur (sans les bots).')
        .addIntegerOption((o) => o.setName('montant').setDescription('Montant pour chaque membre').setRequired(true).setMinValue(1))
        .addStringOption(currencyOption),
    )
    .addSubcommand((s) =>
      s
        .setName('retirer')
        .setDescription('Retirer de l’argent ou des coins à un membre.')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
        .addIntegerOption((o) => o.setName('montant').setDescription('Montant à retirer').setRequired(true).setMinValue(1))
        .addStringOption(currencyOption),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const amount = interaction.options.getInteger('montant', true);
    const currency = CURRENCY[interaction.options.getString('monnaie') ?? 'argent'];
    if (sub === 'tous') return giveEveryone(interaction, amount, currency);
    const target = interaction.options.getUser('membre', true);
    if (target.bot) return interaction.reply({ content: '❌ Un bot n’a pas de porte-monnaie.', ephemeral: true });

    const add = sub === 'ajouter';
    const before = currency.get(interaction.guild.id, target.id);
    const after = currency.add(interaction.guild.id, target.id, add ? amount : -amount);
    const delta = Math.abs(after - before);

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(add ? Colors.join : Colors.leave)
        .setAuthor({ name: add ? `${currency.emoji} ${currency.label} ajouté` : `💸 ${currency.label} retiré` })
        .setDescription(`${add ? '+' : '-'}${formatMoney(delta)} ${currency.emoji} à ${target} (nouveau solde : ${formatMoney(after)})`)
        .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
        .setTimestamp(),
    );

    await interaction.reply({
      content: `✅ ${add ? '+' : '-'}${currency.emoji} **${formatMoney(delta)}** ${add ? 'donné à' : 'retiré à'} ${target}. Nouveau solde : ${currency.emoji} **${formatMoney(after)}**.`,
      ephemeral: true,
    });
  },
};

// /money tous : le même montant pour chaque membre du serveur (les bots sont ignorés).
async function giveEveryone(interaction, amount, currency) {
  const { guild } = interaction;
  await interaction.deferReply({ ephemeral: true });
  const members = await guild.members.fetch().catch(() => null);
  if (!members) return interaction.editReply('❌ Je n’ai pas pu récupérer la liste des membres.');
  const humans = [...members.values()].filter((m) => !m.user.bot);
  for (const m of humans) currency.add(guild.id, m.id, amount);
  await sendLog(
    guild,
    new EmbedBuilder()
      .setColor(Colors.join)
      .setAuthor({ name: `${currency.emoji} ${currency.label} donné à tout le serveur` })
      .setDescription(`+${formatMoney(amount)} ${currency.emoji} pour chacun des **${humans.length}** membres`)
      .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
      .setTimestamp(),
  );
  return interaction.editReply(`✅ +${currency.emoji} **${formatMoney(amount)}** donnés à chacun des **${humans.length}** membres du serveur.`);
}
