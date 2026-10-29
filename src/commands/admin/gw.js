import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { parseDuration } from '../../lib/time.js';
import { formatMoney } from '../../lib/shop.js';
import { roleCommandProblem } from '../../lib/roles.js';
import {
  getGiveaway,
  getGuildGiveaways,
  createGiveaway,
  snapshotInviteTotals,
  removeGiveawayParticipant,
} from '../../lib/store.js';
import {
  buildGiveawayEmbed,
  buildJoinRow,
  scheduleGiveaway,
  endGiveawayNow,
  rerollGiveaway,
  refreshGiveawayCount,
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
        .addStringOption((o) => o.setName('duree').setDescription('Durée (ex: 1h, 30m, 2d)').setRequired(true))
        .addIntegerOption((o) =>
          o.setName('gagnants').setDescription('Nombre de gagnants').setRequired(true).setMinValue(1).setMaxValue(20),
        )
        .addUserOption((o) => o.setName('organisateur').setDescription('Organisé par').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Argent (crédité automatiquement) ou prix personnalisé — facultatif avec un rôle à gagner')
            .addChoices({ name: 'Argent', value: 'argent' }, { name: 'Personnalisé (ex : Nitro)', value: 'perso' }),
        )
        .addStringOption((o) => o.setName('prix').setDescription('Pour « Personnalisé » : le prix (ex : Nitro Boost 1 mois)'))
        .addIntegerOption((o) => o.setName('montant').setDescription('Pour « Argent » : montant gagné par chaque gagnant').setMinValue(1))
        .addRoleOption((o) => o.setName('role_gagne').setDescription('(Facultatif) rôle donné automatiquement aux gagnants (ex : VIP)'))
        .addIntegerOption((o) =>
          o
            .setName('messages_requis')
            .setDescription('(Facultatif) messages requis depuis le début du giveaway')
            .setMinValue(1),
        )
        .addIntegerOption((o) =>
          o
            .setName('invites_requis')
            .setDescription('(Facultatif) invitations requises depuis le début du giveaway')
            .setMinValue(1),
        )
        .addStringOption((o) =>
          o.setName('statut_requis').setDescription('(Facultatif) texte requis dans le statut (ex: /hanami)'),
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
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer-participant')
        .setDescription('Retirer un membre de la liste des participants d’un giveaway.')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre à retirer').setRequired(true))
        .addStringOption((o) => o.setName('message_id').setDescription('ID du message du giveaway (sinon le dernier actif)')),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'start') return this.start(interaction, guildId);
    if (sub === 'end') return this.end(interaction, guildId);
    if (sub === 'reroll') return this.reroll(interaction, guildId);
    if (sub === 'retirer-participant') return this.removeParticipant(interaction, guildId);
  },

  async start(interaction, guildId) {
    const role = interaction.options.getRole('role');
    // Argent : crédité automatiquement à chaque gagnant ; personnalisé : à remettre par l'organisateur ;
    // rôle à gagner (seul ou en plus) : donné automatiquement à la fin.
    const type = interaction.options.getString('type');
    const rewardRole = interaction.options.getRole('role_gagne');
    if (!type && !rewardRole) {
      return interaction.reply({ content: '❌ Choisis un `type` (argent ou personnalisé), un `role_gagne`, ou les deux.', ephemeral: true });
    }
    if (rewardRole) {
      const problem = roleCommandProblem(interaction, rewardRole, 'donner');
      if (problem) return interaction.reply({ content: problem, ephemeral: true });
    }
    const isMoney = type === 'argent';
    const rewardMoney = isMoney ? interaction.options.getInteger('montant') : null;
    const custom = type === 'perso' ? interaction.options.getString('prix')?.trim() : null;
    if (isMoney && !rewardMoney) {
      return interaction.reply({ content: '❌ Pour un giveaway d’argent, indique le `montant` gagné par chaque gagnant.', ephemeral: true });
    }
    if (type === 'perso' && !custom) {
      return interaction.reply({ content: '❌ Pour un prix personnalisé, indique le `prix` (ex : Nitro Boost 1 mois).', ephemeral: true });
    }
    // Prix affiché : le nom du rôle (pas une mention, pour ne pas notifier tout le rôle).
    const prize = [isMoney ? `💰 ${formatMoney(rewardMoney)}` : custom, rewardRole ? `Rôle « ${rewardRole.name} »` : null].filter(Boolean).join(' + ');
    const dureeStr = interaction.options.getString('duree');
    const winners = interaction.options.getInteger('gagnants');
    const host = interaction.options.getUser('organisateur');
    const requiredMessages = interaction.options.getInteger('messages_requis') ?? null;
    const requiredInvites = interaction.options.getInteger('invites_requis') ?? null;
    const requiredStatus = interaction.options.getString('statut_requis')?.trim() || null;

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
      rewardMoney,
      rewardRoleId: rewardRole?.id ?? null,
      customPrize: Boolean(custom),
      winners,
      endsAt,
      hostId: host.id,
      roleId: role.id,
      requiredMessages,
      requiredInvites,
      requiredStatus,
      // Base d'invitations figée au lancement (pour compter « depuis le début »).
      inviteBaseline: requiredInvites ? snapshotInviteTotals(guildId) : null,
      participants: [],
      messageCounts: {},
      ended: false,
      winnerIds: [],
      createdAt: Date.now(),
    };

    const msg = await interaction.channel.send({
      content: `${role}`,
      embeds: [buildGiveawayEmbed(gw)],
      components: [buildJoinRow(0)],
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

  async removeParticipant(interaction, guildId) {
    const user = interaction.options.getUser('membre');
    const messageId = interaction.options.getString('message_id') ?? latestGiveaway(guildId, (gw) => !gw.ended);
    if (!messageId) {
      return interaction.reply({ content: '❌ Aucun giveaway actif trouvé.', ephemeral: true });
    }
    const gw = getGiveaway(guildId, messageId);
    if (!gw) return interaction.reply({ content: `❌ Giveaway \`${messageId}\` introuvable.`, ephemeral: true });
    if (!(gw.participants ?? []).includes(user.id)) {
      return interaction.reply({ content: `ℹ️ ${user} ne participe pas à ce giveaway.`, ephemeral: true });
    }

    removeGiveawayParticipant(guildId, messageId, user.id);
    await refreshGiveawayCount(interaction.client, guildId, messageId).catch(() => {});
    return interaction.reply({ content: `✅ ${user} a été retiré des participants du giveaway.`, ephemeral: true });
  },
};
