import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { addMoney, getMoney } from '../../lib/store.js';
import { formatMoney } from '../../lib/shop.js';
import { sendLog, Colors } from '../../lib/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('add-money')
    .setDescription('Donner de l’argent à un membre.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addIntegerOption((o) => o.setName('montant').setDescription('Montant à ajouter').setRequired(true).setMinValue(1)),

  async execute(interaction) {
    const target = interaction.options.getUser('membre', true);
    const amount = interaction.options.getInteger('montant', true);
    if (target.bot) return interaction.reply({ content: '❌ Un bot n’a pas de porte-monnaie.', ephemeral: true });
    const after = addMoney(interaction.guild.id, target.id, amount);
    await sendLog(
      interaction.guild,
      new (await import('discord.js')).EmbedBuilder()
        .setColor(Colors.join)
        .setAuthor({ name: '💰 Argent ajouté' })
        .setDescription(`+${formatMoney(amount)} à ${target} (nouveau solde : ${formatMoney(after)})`)
        .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
        .setTimestamp(),
    );
    await interaction.reply({ content: `✅ +💰 **${formatMoney(amount)}** donné à ${target}. Nouveau solde : 💰 **${formatMoney(after)}**.`, ephemeral: true });
  },
};
