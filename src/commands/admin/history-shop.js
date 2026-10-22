import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getPurchases } from '../../lib/store.js';
import { formatMoney, inventoryEmbed } from '../../lib/shop.js';

export default {
  data: new SlashCommandBuilder()
    .setName('history-shop')
    .setDescription('Voir l’historique des achats de la boutique (ou ceux d’un membre).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addUserOption((o) => o.setName('membre').setDescription('(Facultatif) voir les achats d’un membre précis')),

  async execute(interaction) {
    const user = interaction.options.getUser('membre');
    const purchases = getPurchases(interaction.guild.id, user?.id ?? null);

    if (user) {
      // Tout ce que le membre a acheté, + la liste détaillée.
      const embed = inventoryEmbed(interaction.guild, user.id, `🧾 Achats de ${user.username}`);
      const lines = purchases
        .slice(0, 20)
        .map((p) => `• **${p.name}** — 💰 ${formatMoney(p.price)} · <t:${Math.floor(p.at / 1000)}:R>`)
        .join('\n');
      if (lines) embed.addFields({ name: `Derniers achats (${purchases.length})`, value: lines.slice(0, 1024) });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (!purchases.length) return interaction.reply({ content: 'ℹ️ Aucun achat pour le moment.', ephemeral: true });
    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🧾 Historique des achats')
      .setDescription(
        purchases
          .slice(0, 20)
          .map((p) => `<@${p.userId}> → **${p.name}** (💰 ${formatMoney(p.price)}) · <t:${Math.floor(p.at / 1000)}:R>`)
          .join('\n')
          .slice(0, 4000),
      )
      .setFooter({ text: `${purchases.length} achat(s) au total` });
    return interaction.reply({ embeds: [embed], ephemeral: true, allowedMentions: { parse: [] } });
  },
};
