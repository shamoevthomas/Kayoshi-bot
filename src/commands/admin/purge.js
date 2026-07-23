import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../../lib/logger.js';

const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;

export default {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Supprimer des messages dans ce salon (sans limite, par lots).')
    .addIntegerOption((o) =>
      o.setName('nombre').setDescription('Combien de messages supprimer').setRequired(true).setMinValue(1),
    )
    .addUserOption((o) => o.setName('membre').setDescription('Ne supprimer que les messages de ce membre'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getInteger('nombre');
    const member = interaction.options.getUser('membre');
    await interaction.deferReply({ ephemeral: true });

    const cutoff = Date.now() - TWO_WEEKS; // Discord interdit la suppression en masse au-delà de 14 jours
    let deleted = 0;
    let lastId;
    let reachedOld = false;

    // Boucle par lots de 100 jusqu'à atteindre le nombre voulu (ou plus de messages).
    for (let i = 0; i < 500 && deleted < target; i++) {
      const batch = await interaction.channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
      if (!batch || batch.size === 0) break;
      lastId = batch.last().id;

      let candidates = batch.filter((m) => m.createdTimestamp > cutoff);
      if (member) candidates = candidates.filter((m) => m.author.id === member.id);

      const toDelete = [...candidates.values()].slice(0, target - deleted);
      if (toDelete.length) {
        const res = await interaction.channel.bulkDelete(toDelete, true).catch(() => null);
        deleted += res?.size ?? 0;
      }

      // Si le lot contient des messages de +14 jours, inutile de remonter plus loin.
      if (batch.some((m) => m.createdTimestamp <= cutoff)) {
        reachedOld = true;
        break;
      }
    }

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.delete)
        .setAuthor({ name: '🧹 Purge de messages' })
        .setDescription(`**${deleted}** message(s) supprimé(s) dans ${interaction.channel}${member ? ` (de ${member})` : ''}`)
        .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
        .setTimestamp(),
    );

    await interaction.editReply(
      `✅ **${deleted}** message(s) supprimé(s).` +
        (reachedOld ? '\nℹ️ Arrêt atteint : les messages de plus de 14 jours ne peuvent pas être supprimés en masse (limite Discord).' : '') +
        (deleted < target && !reachedOld ? '\nℹ️ Il n’y avait pas assez de messages à supprimer.' : ''),
    );
  },
};
