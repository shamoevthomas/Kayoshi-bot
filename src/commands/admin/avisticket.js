import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getAvisConfig, setAvisConfig } from '../../lib/store.js';

export default {
  data: new SlashCommandBuilder()
    .setName('avisticket')
    .setDescription('Salon où sont postés les avis (notes ⭐) laissés à la fermeture des tickets.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('activer')
        .setDescription('Choisir le salon des avis.')
        .addChannelOption((o) =>
          o
            .setName('salon')
            .setDescription('Salon où poster les avis')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        ),
    )
    .addSubcommand((sub) => sub.setName('desactiver').setDescription('Désactiver les avis.'))
    .addSubcommand((sub) => sub.setName('voir').setDescription('Voir la configuration.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'voir') {
      const c = getAvisConfig(guildId);
      return interaction.reply({
        content: c?.channelId ? `⭐ Les avis sont postés dans <#${c.channelId}>.` : '🔕 Avis désactivés.',
        ephemeral: true,
      });
    }

    if (sub === 'desactiver') {
      setAvisConfig(guildId, { channelId: null });
      return interaction.reply({ content: '🔕 Avis désactivés.', ephemeral: true });
    }

    // activer
    const channel = interaction.options.getChannel('salon');
    const perms = channel.permissionsFor(interaction.guild.members.me);
    if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms.has(PermissionFlagsBits.EmbedLinks)) {
      return interaction.reply({
        content: `❌ Il me faut **Envoyer des messages** et **Intégrer des liens** dans ${channel}.`,
        ephemeral: true,
      });
    }
    setAvisConfig(guildId, { channelId: channel.id });
    return interaction.reply({
      content:
        `✅ Les avis des tickets seront postés dans ${channel}.\n` +
        `À la fermeture d'un ticket, le membre pourra **noter le support (1-5 ⭐)** et laisser un **commentaire** depuis son MP.`,
      ephemeral: true,
    });
  },
};
