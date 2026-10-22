import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { setLevelUpConfig, getLevelsEnabled, setLevelsEnabled, getLevelUpMessage, levelUpChannelId } from '../../lib/store.js';
import { formatLevelUp } from '../../lib/levels.js';

const DEFAULT_LEVELUP = 'bien joué {user} tu viens de passer au niveau {level} !';

export default {
  data: new SlashCommandBuilder()
    .setName('configniveau')
    .setDescription('Activer/désactiver le système de niveaux et personnaliser son message.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('activer').setDescription('Activer le système d’XP et de niveaux.'))
    .addSubcommand((s) => s.setName('desactiver').setDescription('Désactiver le système (plus d’XP ni de message de niveau).'))
    .addSubcommand((s) => s.setName('voir').setDescription('Voir l’état et la configuration actuelle.'))
    .addSubcommand((s) =>
      s
        .setName('message')
        .setDescription('Personnaliser le message de passage de niveau et son salon.')
        .addStringOption((o) =>
          o
            .setName('message')
            .setDescription('Texte. Variables : {user} {username} {level} {server}')
            .setRequired(true)
            .setMaxLength(1500),
        )
        .addChannelOption((o) =>
          o
            .setName('salon')
            .setDescription('Salon d’annonce (par défaut : là où le membre monte de niveau)')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(false),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'activer') {
      setLevelsEnabled(guildId, true);
      return interaction.reply({ content: '✅ Système de niveaux **activé** : les membres gagnent de l’XP en écrivant.', ephemeral: true });
    }

    if (sub === 'desactiver') {
      setLevelsEnabled(guildId, false);
      return interaction.reply({
        content: '🛑 Système de niveaux **désactivé**. (L’XP déjà gagnée est conservée ; réactive avec `/configniveau activer`.)',
        ephemeral: true,
      });
    }

    if (sub === 'voir') {
      const enabled = getLevelsEnabled(guildId);
      const channelId = levelUpChannelId(guildId);
      const message = getLevelUpMessage(guildId) ?? DEFAULT_LEVELUP;
      return interaction.reply({
        content:
          `${enabled ? '✅ Système de niveaux **activé**' : '🛑 Système de niveaux **désactivé**'}\n` +
          `• Salon d’annonce : ${channelId ? `<#${channelId}>` : '_là où le membre monte de niveau_'}\n` +
          `• Message : ${message}`,
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    }

    // message
    const message = interaction.options.getString('message');
    const salon = interaction.options.getChannel('salon');
    setLevelUpConfig(guildId, { message, channelId: salon?.id ?? null });
    const preview = formatLevelUp(message, { user: interaction.user, level: 5, guild: interaction.guild });

    await interaction.reply({
      content:
        `✅ **Message de niveau enregistré.**\n` +
        (getLevelsEnabled(guildId) ? '' : '⚠️ Le système est **désactivé** — active-le avec `/configniveau activer`.\n') +
        `• Salon : ${salon ? `${salon}` : '_là où le membre monte de niveau_'}\n` +
        `• Variables : \`{user}\` \`{username}\` \`{level}\` \`{server}\`\n\n` +
        `**Aperçu (niveau 5) :**\n${preview}`,
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  },
};
