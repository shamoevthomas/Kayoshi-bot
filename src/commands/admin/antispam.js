import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getAntiSpamConfig, setAntiSpamConfig } from '../../lib/store.js';

export default {
  data: new SlashCommandBuilder()
    .setName('antispam')
    .setDescription('Système anti-spam : sanctionne les messages trop rapides.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('activer')
        .setDescription('Activer / régler l’anti-spam.')
        .addIntegerOption((o) =>
          o.setName('messages').setDescription('Nombre de messages max (défaut : 5)').setMinValue(2).setMaxValue(20),
        )
        .addIntegerOption((o) =>
          o.setName('secondes').setDescription('Fenêtre de temps en secondes (défaut : 5)').setMinValue(1).setMaxValue(60),
        )
        .addIntegerOption((o) =>
          o
            .setName('mute_minutes')
            .setDescription('Durée du mute en minutes (0 = pas de mute, juste suppression ; défaut : 5)')
            .setMinValue(0)
            .setMaxValue(1440),
        )
        .addRoleOption((o) => o.setName('role_exempt').setDescription('(Facultatif) rôle exempté de l’anti-spam')),
    )
    .addSubcommand((sub) => sub.setName('desactiver').setDescription('Désactiver l’anti-spam.'))
    .addSubcommand((sub) => sub.setName('voir').setDescription('Voir la configuration actuelle.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'voir') {
      const c = getAntiSpamConfig(guildId);
      if (!c?.enabled) return interaction.reply({ content: '🔕 Anti-spam **désactivé**.', ephemeral: true });
      return interaction.reply({
        content:
          `🛡️ **Anti-spam activé**\n` +
          `• Seuil : **${c.maxMessages}** messages en **${Math.round(c.intervalMs / 1000)}s**\n` +
          `• Mute : ${c.timeoutMs > 0 ? `**${Math.round(c.timeoutMs / 60000)} min**` : 'aucun (suppression seule)'}\n` +
          `• Rôles exemptés : ${c.exemptRoleIds?.length ? c.exemptRoleIds.map((r) => `<@&${r}>`).join(' ') : '_aucun_'}\n` +
          `_(Le staff « Gérer les messages » est toujours exempté.)_`,
        ephemeral: true,
      });
    }

    if (sub === 'desactiver') {
      const c = getAntiSpamConfig(guildId) ?? {};
      setAntiSpamConfig(guildId, { ...c, enabled: false });
      return interaction.reply({ content: '🔕 Anti-spam **désactivé**.', ephemeral: true });
    }

    // activer
    const prev = getAntiSpamConfig(guildId) ?? {};
    const maxMessages = interaction.options.getInteger('messages') ?? prev.maxMessages ?? 5;
    const seconds = interaction.options.getInteger('secondes') ?? Math.round((prev.intervalMs ?? 5000) / 1000);
    const muteMin = interaction.options.getInteger('mute_minutes') ?? Math.round((prev.timeoutMs ?? 300000) / 60000);
    const role = interaction.options.getRole('role_exempt');

    const config = {
      enabled: true,
      maxMessages,
      intervalMs: seconds * 1000,
      timeoutMs: muteMin * 60000,
      exemptRoleIds: role ? [role.id] : prev.exemptRoleIds ?? [],
    };
    setAntiSpamConfig(guildId, config);

    return interaction.reply({
      content:
        `✅ **Anti-spam activé.**\n` +
        `• Seuil : **${maxMessages}** messages en **${seconds}s**\n` +
        `• Mute : ${muteMin > 0 ? `**${muteMin} min**` : 'aucun (suppression seule)'}\n` +
        `• Rôle exempté : ${role ? `${role}` : '_aucun_'}\n` +
        `_(Il me faut la permission **Exclure des membres** pour le mute.)_`,
      ephemeral: true,
    });
  },
};
