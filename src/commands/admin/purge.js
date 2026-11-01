import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../../lib/logger.js';

const TWO_WEEKS = 14 * 24 * 60 * 60 * 1000;
const NEEDED = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages];

// Messages plus récents que `cutoff` dans `channel` (du membre s'il est donné), du plus récent au plus ancien, `limit` au plus.
async function collect(channel, { member, limit, cutoff }) {
  const found = [];
  let lastId;
  let reachedOld = false;
  // Lots de 100 jusqu'à en avoir assez (ou plus de messages).
  for (let i = 0; i < 500 && found.length < limit; i++) {
    const batch = await channel.messages.fetch({ limit: 100, before: lastId }).catch(() => null);
    if (!batch?.size) break;
    lastId = batch.last().id;
    for (const m of batch.values()) if (m.createdTimestamp > cutoff && (!member || m.author.id === member.id)) found.push(m);
    // Le lot atteint des messages trop anciens : inutile de remonter plus loin.
    if (batch.some((m) => m.createdTimestamp <= cutoff)) {
      reachedOld = true;
      break;
    }
  }
  return { messages: found.slice(0, limit), reachedOld };
}

async function remove(channel, messages) {
  let deleted = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const res = await channel.bulkDelete(messages.slice(i, i + 100), true).catch(() => null);
    deleted += res?.size ?? 0;
  }
  return deleted;
}

export default {
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Supprimer des messages dans ce salon, ou dans tous les salons pour un membre.')
    .addIntegerOption((o) =>
      o.setName('nombre').setDescription('Combien de messages supprimer').setRequired(true).setMinValue(1),
    )
    .addUserOption((o) => o.setName('membre').setDescription('Ne supprimer que les messages de ce membre'))
    .addBooleanOption((o) =>
      o.setName('tous_les_salons').setDescription('Supprimer dans tous les salons (le membre est alors obligatoire)'),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getInteger('nombre');
    const member = interaction.options.getUser('membre');
    const everywhere = interaction.options.getBoolean('tous_les_salons') ?? false;
    if (everywhere && !member) {
      return interaction.reply({ content: '❌ Pour purger dans tous les salons, choisis un **membre**.', ephemeral: true });
    }
    await interaction.deferReply({ ephemeral: true });

    const cutoff = Date.now() - TWO_WEEKS; // Discord interdit la suppression en masse au-delà de 14 jours
    let deleted = 0;
    let reachedOld = false;
    let where = `${interaction.channel}`;

    if (!everywhere) {
      const found = await collect(interaction.channel, { member, limit: target, cutoff });
      deleted = await remove(interaction.channel, found.messages);
      reachedOld = found.reachedOld;
    } else {
      // Les `nombre` messages les plus récents du membre, tous salons confondus (salons que le bot et l'auteur
      // de la commande peuvent gérer).
      const channels = [
        ...interaction.guild.channels.cache
          .filter((c) => c.isTextBased() && [interaction.guild.members.me, interaction.member].every((who) => c.permissionsFor(who)?.has(NEEDED)))
          .values(),
      ];
      const start = Date.now();
      let all = [];
      let scanned = 0;
      for (const channel of channels) {
        if (Date.now() - start > 10 * 60_000) break; // la réponse doit partir avant 15 min (limite Discord)
        if (scanned % 5 === 0) {
          await interaction.editReply(`🔎 Recherche des messages de ${member}… (salon ${scanned + 1}/${channels.length})`).catch(() => {});
        }
        // Déjà assez de messages : dans les salons suivants, seuls les plus récents que le dernier retenu comptent.
        const floor = all.length >= target ? all[target - 1].createdTimestamp : cutoff;
        const found = await collect(channel, { member, limit: target, cutoff: floor });
        all = [...all, ...found.messages].sort((a, b) => b.createdTimestamp - a.createdTimestamp).slice(0, target);
        scanned++;
      }
      const byChannel = new Map();
      for (const m of all) byChannel.set(m.channel, [...(byChannel.get(m.channel) ?? []), m]);
      for (const [channel, messages] of byChannel) deleted += await remove(channel, messages);
      where = `**${byChannel.size}** salon(s) sur ${scanned} parcouru(s)`;
      if (scanned < channels.length) where += ` (recherche arrêtée : trop longue, ${channels.length - scanned} salon(s) non parcouru(s))`;
    }

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.delete)
        .setAuthor({ name: '🧹 Purge de messages' })
        .setDescription(`**${deleted}** message(s) supprimé(s) dans ${where}${member ? ` (de ${member})` : ''}`)
        .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
        .setTimestamp(),
    );

    let note = '';
    if (everywhere && deleted < target) {
      note = '\nℹ️ Il n’y en avait pas plus de moins de 14 jours : les plus anciens ne peuvent pas être supprimés en masse (limite Discord).';
    } else if (reachedOld) {
      note = '\nℹ️ Arrêt atteint : les messages de plus de 14 jours ne peuvent pas être supprimés en masse (limite Discord).';
    } else if (deleted < target) note = '\nℹ️ Il n’y avait pas assez de messages à supprimer.';
    await interaction.editReply(`✅ **${deleted}** message(s) supprimé(s)${everywhere ? ` dans ${where}` : ''}.${note}`);
  },
};
