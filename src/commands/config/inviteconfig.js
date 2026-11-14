import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { setInviteLogChannel, getInviteLogChannel } from '../../lib/store.js';

export default {
  data: new SlashCommandBuilder()
    .setName('inviteconfig')
    .setDescription('Configurer le salon de suivi des invitations.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('salon')
        .setDescription('Définir le salon où sera envoyé le suivi des invitations.')
        .addChannelOption((opt) =>
          opt
            .setName('salon')
            .setDescription('Le salon de suivi des invitations')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('desactiver').setDescription('Désactiver le salon dédié (revient aux logs généraux).'),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'salon') {
      const channel = interaction.options.getChannel('salon');

      // Vérifie que le bot peut écrire dans ce salon.
      const me = interaction.guild.members.me;
      if (me && !channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) {
        return interaction.reply({
          content: `⚠️ Je n'ai pas la permission d'écrire dans ${channel}. Donne-moi l'accès puis réessaie.`,
          ephemeral: true,
        });
      }

      setInviteLogChannel(guildId, channel.id);
      return interaction.reply({
        content: `✅ Le suivi des invitations sera envoyé dans ${channel}.`,
        ephemeral: true,
      });
    }

    // sub === 'desactiver'
    if (!getInviteLogChannel(guildId)) {
      return interaction.reply({ content: 'Aucun salon dédié n’est configuré.', ephemeral: true });
    }
    setInviteLogChannel(guildId, null);
    return interaction.reply({
      content: '🗑️ Salon dédié désactivé. Le suivi repart dans le salon de logs général (s’il existe).',
      ephemeral: true,
    });
  },
};
