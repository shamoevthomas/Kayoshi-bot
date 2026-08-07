import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { parseDuration } from '../../lib/time.js';
import { getGiveaway, getGuildGiveaways, createGiveaway } from '../../lib/store.js';
import {
  buildGiveawayEmbed,
  buildJoinRow,
  scheduleGiveaway,
  endGiveawayNow,
  rerollGiveaway,
} from '../../lib/giveaways.js';

// Renvoie l'ID du dernier giveaway correspondant au filtre (par ordre de création).
function latestGiveaway(guildId, filter) {
  const gws = Object.entries(getGuildGiveaways(guildId))
    .filter(([, gw]) => filter(gw))
    .sort((a, b) => (b[1].createdAt ?? 0) - (a[1].createdAt ?? 0));
  return gws[0]?.[0] ?? null;
}

export default {
  data: new SlashCommandBuilder()
    .setName('gw')
    .setDescription('Gérer les giveaways.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('start')
        .setDescription('Lancer un giveaway.')
        .addRoleOption((o) => o.setName('role').setDescription('Rôle à mentionner').setRequired(true))
        .addStringOption((o) => o.setName('prix').setDescription('Le prix (ex: Nitro Boost 1 mois)').setRequired(true))
        .addStringOption((o) => o.setName('duree').setDescription('Durée (ex: 1h, 30m, 2d)').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('gagnants').setDescription('Nombre de gagnants').setRequired(true).setMinValue(1).setMaxValue(20),
        )
        .addUserOption((o) => o.setName('organisateur').setDescription('Organisé par').setRequired(true))
        .addIntegerOption((o) =>
          o
            .setName('messages_requis')
            .setDescription('(Facultatif) messages requis depuis le début du giveaway')
            .setMinValue(1),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('end')
        .setDescription('Terminer un giveaway maintenant.')
        .addStringOption((o) => o.setName('message_id').setDescription('ID du message du giveaway (sinon le dernier actif)')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('reroll')
        .setDescription('Retirer un nouveau gagnant.')
        .addStringOption((o) => o.setName('message_id').setDescription('ID du message du giveaway (sinon le dernier terminé)')),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'start') return this.start(interaction, guildId);
    if (sub === 'end') return this.end(interaction, guildId);
    if (sub === 'reroll') return this.reroll(interaction, guildId);
  },

  async start(interaction, guildId) {
    const role = interaction.options.getRole('role');
    const prize = interaction.options.getString('prix').trim();
    const dureeStr = interaction.options.getString('duree');
    const winners = interaction.options.getInteger('gagnants');
    const host = interaction.options.getUser('organisateur');
    const requiredMessages = interaction.options.getInteger('messages_requis') ?? null;

    const parsed = parseDuration(dureeStr);
    if (!parsed || parsed.permanent || !parsed.ms) {
      return interaction.reply({
        content: '❌ Durée invalide. Exemples : `1h`, `30m`, `2d`, `1w`.',
        ephemeral: true,
      });
    }

    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionFlagsBits.SendMessages)) {
      return interaction.reply({ content: '❌ Je ne peux pas envoyer de message ici.', ephemeral: true });
    }

    const endsAt = Date.now() + parsed.ms;
    const gw = {
      channelId: interaction.channelId,
      prize,
      winners,
      endsAt,
      hostId: host.id,
      roleId: role.id,
      requiredMessages,
      participants: [],
      messageCounts: {},
      ended: false,
      winnerIds: [],
      createdAt: Date.now(),
    };

    const msg = await interaction.channel.send({
      content: `${role}`,
      embeds: [buildGiveawayEmbed(gw)],
      components: [buildJoinRow()],
      allowedMentions: { roles: [role.id] },
    });

    gw.messageId = msg.id;
    createGiveaway(guildId, msg.id, gw);
    scheduleGiveaway(interaction.client, guildId, msg.id, endsAt);

    return interaction.reply({ content: `✅ Giveaway lancé ! (ID : \`${msg.id}\`)`, ephemeral: true });
  },

  async end(interaction, guildId) {
    const messageId = interaction.options.getString('message_id') ?? latestGiveaway(guildId, (gw) => !gw.ended);
    if (!messageId) {
      return interaction.reply({ content: '❌ Aucun giveaway actif trouvé.', ephemeral: true });
    }
    const gw = getGiveaway(guildId, messageId);
    if (!gw) return interaction.reply({ content: `❌ Giveaway \`${messageId}\` introuvable.`, ephemeral: true });
    if (gw.ended) return interaction.reply({ content: 'ℹ️ Ce giveaway est déjà terminé.', ephemeral: true });

    await interaction.reply({ content: '⏳ Fin du giveaway…', ephemeral: true });
    const winners = await endGiveawayNow(interaction.client, guildId, messageId);
    return interaction.editReply({
      content: winners?.length
        ? `✅ Giveaway terminé — ${winners.length} gagnant(s) tiré(s).`
        : '✅ Giveaway terminé — aucun participant éligible.',
    });
  },

  async reroll(interaction, guildId) {
    const messageId = interaction.options.getString('message_id') ?? latestGiveaway(guildId, (gw) => gw.ended);
    if (!messageId) {
      return interaction.reply({ content: '❌ Aucun giveaway terminé à relancer.', ephemeral: true });
    }

    await interaction.reply({ content: '⏳ Nouveau tirage…', ephemeral: true });
    const res = await rerollGiveaway(interaction.client, guildId, messageId);
    if (!res.ok) {
      const messages = {
        'not-found': `❌ Giveaway \`${messageId}\` introuvable.`,
        'not-ended': '❌ Ce giveaway n’est pas encore terminé. Utilise `/gw end` d’abord.',
        'no-eligible': '❌ Aucun participant éligible pour un nouveau tirage.',
      };
      return interaction.editReply({ content: messages[res.reason] ?? '❌ Échec du reroll.' });
    }
    return interaction.editReply({ content: `✅ Nouveau gagnant tiré (${res.winners.length}).` });
  },
};
