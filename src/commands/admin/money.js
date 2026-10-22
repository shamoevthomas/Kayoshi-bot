import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { addMoney, getMoney } from '../../lib/store.js';
import { formatMoney } from '../../lib/shop.js';
import { sendLog, Colors } from '../../lib/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('money')
    .setDescription('Donner ou retirer de l’argent (boutique) à un membre.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('ajouter')
        .setDescription('Donner de l’argent à un membre.')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
        .addIntegerOption((o) => o.setName('montant').setDescription('Montant à ajouter').setRequired(true).setMinValue(1)),
    )
    .addSubcommand((s) =>
      s
        .setName('retirer')
        .setDescription('Retirer de l’argent à un membre.')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
        .addIntegerOption((o) => o.setName('montant').setDescription('Montant à retirer').setRequired(true).setMinValue(1)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('membre', true);
    const amount = interaction.options.getInteger('montant', true);
    if (target.bot) return interaction.reply({ content: '❌ Un bot n’a pas de porte-monnaie.', ephemeral: true });

    const add = sub === 'ajouter';
    const before = getMoney(interaction.guild.id, target.id);
    const after = addMoney(interaction.guild.id, target.id, add ? amount : -amount);
    const delta = Math.abs(after - before);

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(add ? Colors.join : Colors.leave)
        .setAuthor({ name: add ? '💰 Argent ajouté' : '💸 Argent retiré' })
        .setDescription(`${add ? '+' : '-'}${formatMoney(delta)} à ${target} (nouveau solde : ${formatMoney(after)})`)
        .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
        .setTimestamp(),
    );

    await interaction.reply({
      content: `✅ ${add ? '+' : '-'}💰 **${formatMoney(delta)}** ${add ? 'donné à' : 'retiré à'} ${target}. Nouveau solde : 💰 **${formatMoney(after)}**.`,
      ephemeral: true,
    });
  },
};
