import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import {
  addOneMessageChannel,
  removeOneMessageChannel,
  getOneMessageChannels,
} from '../../lib/store.js';

const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice];

export default {
  data: new SlashCommandBuilder()
    .setName('one-message')
    .setDescription('Salon où tout nouveau message est supprimé automatiquement.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('activer')
        .setDescription('Activer la suppression auto des messages dans un salon.')
        .addChannelOption((o) =>
          o.setName('salon').setDescription('Le salon à verrouiller').addChannelTypes(...TEXT_TYPES).setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('desactiver')
        .setDescription('Désactiver la suppression auto dans un salon.')
        .addChannelOption((o) =>
          o.setName('salon').setDescription('Le salon à déverrouiller').addChannelTypes(...TEXT_TYPES).setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Voir les salons concernés.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'liste') {
      const ids = getOneMessageChannels(guildId);
      if (!ids.length) {
        return interaction.reply({ content: 'Aucun salon en mode « one-message ».', ephemeral: true });
      }
      return interaction.reply({
        content: `🔒 Salons en mode « one-message » :\n${ids.map((id) => `• <#${id}>`).join('\n')}`,
        ephemeral: true,
      });
    }

    const channel = interaction.options.getChannel('salon');

    if (sub === 'activer') {
      const perms = channel.permissionsFor(interaction.guild.members.me);
      if (!perms?.has(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({
          content: `❌ Il me faut la permission **Gérer les messages** dans ${channel} pour supprimer les messages.`,
          ephemeral: true,
        });
      }
      const added = addOneMessageChannel(guildId, channel.id);
      return interaction.reply({
        content: added
          ? `✅ ${channel} est maintenant en mode « one-message » : tout nouveau message y sera supprimé aussitôt. (Les anciens messages restent.)`
          : `ℹ️ ${channel} est déjà en mode « one-message ».`,
        ephemeral: true,
      });
    }

    // desactiver
    const removed = removeOneMessageChannel(guildId, channel.id);
    return interaction.reply({
      content: removed
        ? `✅ ${channel} n'est plus en mode « one-message ». Les membres peuvent de nouveau écrire.`
        : `ℹ️ ${channel} n'était pas en mode « one-message ».`,
      ephemeral: true,
    });
  },
};
