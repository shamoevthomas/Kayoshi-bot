import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { getMoney, addMoney, getCoins, addCoins } from '../../lib/store.js';
import { parseAmount } from '../../lib/economy.js';
import { formatMoney } from '../../lib/shop.js';
import { sendLog, Colors } from '../../lib/logger.js';

// /pay : donner de l'argent 💰 (celui des niveaux et de /shop) à un membre, ou des coins 🪙 du casino avec
// l'option monnaie (comme « .pay »). Le montant s'écrit comme au casino : 500, 2k, moitié, tout. Noté dans les logs.
const CURRENCY = {
  argent: { emoji: '💰', get: getMoney, add: addMoney },
  coins: { emoji: '🪙', get: getCoins, add: addCoins },
};

export default {
  data: new SlashCommandBuilder()
    .setName('pay')
    .setDescription('Donner de l’argent 💰 (ou des coins 🪙) à un membre.')
    .setDMPermission(false)
    .addUserOption((o) => o.setName('membre').setDescription('Le membre qui reçoit').setRequired(true))
    .addStringOption((o) => o.setName('montant').setDescription('Ex : 500, 2k, moitié, tout').setRequired(true).setMaxLength(20))
    .addStringOption((o) =>
      o
        .setName('monnaie')
        .setDescription('Argent 💰 (par défaut) ou coins 🪙 du casino')
        .addChoices({ name: '💰 Argent', value: 'argent' }, { name: '🪙 Coins', value: 'coins' }),
    ),

  async execute(interaction) {
    const { guild, user } = interaction;
    const target = interaction.options.getUser('membre');
    const currency = CURRENCY[interaction.options.getString('monnaie') ?? 'argent'];
    const fail = (content) => interaction.reply({ content: `❌ ${content}`, ephemeral: true });
    if (target.bot) return fail('On ne peut pas payer un bot.');
    if (target.id === user.id) return fail('Tu ne peux pas te payer toi-même.');
    if (!(await guild.members.fetch(target.id).catch(() => null))) return fail(`${target} n’est pas sur le serveur.`);

    const balance = currency.get(guild.id, user.id);
    const amount = parseAmount(interaction.options.getString('montant'), balance);
    if (!amount || amount <= 0) return fail('Montant invalide : écris par exemple `500`, `2k`, `moitié` ou `tout`.');
    if (amount > balance) return fail(`Tu n’as que ${currency.emoji} **${formatMoney(balance)}**.`);

    currency.add(guild.id, user.id, -amount);
    currency.add(guild.id, target.id, amount);
    await interaction.reply({
      content: `💸 ${user} a donné ${currency.emoji} **${formatMoney(amount)}** à ${target} !`,
      allowedMentions: { users: [target.id] },
    });
    await sendLog(
      guild,
      new EmbedBuilder()
        .setColor(Colors.role)
        .setAuthor({ name: '💸 Paiement entre membres', iconURL: user.displayAvatarURL() })
        .setDescription(`${user} (${user.tag}) → ${target} (${target.tag}) : ${currency.emoji} **${formatMoney(amount)}**`)
        .setTimestamp(),
    ).catch(() => {});
  },
};
