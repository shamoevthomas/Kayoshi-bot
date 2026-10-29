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
        .setName('retirer')
        .setDescription('Retirer de l’argent ou des coins à un membre.')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
        .addIntegerOption((o) => o.setName('montant').setDescription('Montant à retirer').setRequired(true).setMinValue(1))
        .addStringOption(currencyOption),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('membre', true);
    const amount = interaction.options.getInteger('montant', true);
    const currency = CURRENCY[interaction.options.getString('monnaie') ?? 'argent'];
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
