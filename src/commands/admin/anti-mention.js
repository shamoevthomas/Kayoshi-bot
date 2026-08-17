import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getNoMentionChannels, addNoMentionChannel, removeNoMentionChannel } from '../../lib/store.js';

export default {
  data: new SlashCommandBuilder()
    .setName('anti-mention')
    .setDescription('Supprimer les messages qui mentionnent un salon précis.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('ajouter')
        .setDescription('Interdire la mention d’un salon.')
        .addChannelOption((o) => o.setName('salon').setDescription('Le salon qui ne doit plus être mentionné').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('Réautoriser la mention d’un salon.')
        .addChannelOption((o) => o.setName('salon').setDescription('Le salon à réautoriser').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Voir les salons dont la mention est interdite.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'liste') {
      const ids = getNoMentionChannels(guildId);
      if (!ids.length) return interaction.reply({ content: 'Aucun salon protégé contre les mentions.', ephemeral: true });
      return interaction.reply({
        content: `🔗 **Salons dont la mention est interdite :**\n${ids.map((id) => `• <#${id}>`).join('\n')}`,
        ephemeral: true,
      });
    }

    const channel = interaction.options.getChannel('salon');

    if (sub === 'ajouter') {
      const added = addNoMentionChannel(guildId, channel.id);
      return interaction.reply({
        content: added
          ? `✅ Tout message qui mentionne ${channel} sera désormais supprimé (sauf pour le staff).`
          : `ℹ️ ${channel} est déjà protégé.`,
        ephemeral: true,
      });
    }

    // retirer
    const removed = removeNoMentionChannel(guildId, channel.id);
    return interaction.reply({
      content: removed ? `✅ ${channel} peut de nouveau être mentionné.` : `ℹ️ ${channel} n'était pas protégé.`,
      ephemeral: true,
    });
  },
};
