import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getAntiSpamConfig, setAntiSpamConfig } from '../../lib/store.js';
import { MULTI_WINDOW_MS, MULTI_SAME_CHANNELS, MULTI_MIN_CHANNELS, MULTI_TIMEOUT_MS } from '../../lib/antispam.js';

// Règle fixe, active avec l'anti-spam.
const MULTI_LINE =
  `• Multi-salons : le même message dans **${MULTI_SAME_CHANNELS}** salons, ou des messages dans **${MULTI_MIN_CHANNELS}** salons, ` +
  `en **${MULTI_WINDOW_MS / 1000}s** → mute **${MULTI_TIMEOUT_MS / 3_600_000} h**\n`;

const STAFF_NOTE =
  '_Le staff (« Gérer les messages ») est toujours exempté : pour tester, utilise un compte sans cette permission._';

const ignoredLine = (ids) => `• Salons ignorés : ${ids?.length ? ids.map((id) => `<#${id}>`).join(' ') : '_aucun_'}\n`;

// Permissions sans lesquelles l'anti-spam ne peut ni supprimer ni mute.
function missingPermissions(guild) {
  const me = guild.members.me;
  const missing = [];
  if (!me.permissions.has(PermissionFlagsBits.ManageMessages)) missing.push('**Gérer les messages** (supprimer le spam)');
  if (!me.permissions.has(PermissionFlagsBits.ModerateMembers)) missing.push('**Exclure temporairement des membres** (mute)');
  return missing.length ? `⚠️ Il me manque : ${missing.join(', ')}.\n` : '';
}

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
    .addSubcommand((sub) =>
      sub
        .setName('ignorer')
        .setDescription('Ignorer un salon ou une catégorie (relancer sur le même salon pour ne plus l’ignorer).')
        .addChannelOption((o) =>
          o
            .setName('salon')
            .setDescription('Salon ou catégorie que l’anti-spam doit ignorer')
            .setRequired(true)
            .addChannelTypes(
              ChannelType.GuildText,
              ChannelType.GuildAnnouncement,
              ChannelType.GuildVoice,
              ChannelType.GuildForum,
              ChannelType.GuildCategory,
            ),
        ),
    )
    .addSubcommand((sub) => sub.setName('desactiver').setDescription('Désactiver l’anti-spam.'))
    .addSubcommand((sub) => sub.setName('voir').setDescription('Voir la configuration actuelle.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'voir') {
      const c = getAntiSpamConfig(guildId);
      if (!c?.enabled) {
        return interaction.reply({ content: `🔕 Anti-spam **désactivé**.\n${ignoredLine(c?.ignoredChannelIds)}`, ephemeral: true });
      }
      return interaction.reply({
        content:
          `🛡️ **Anti-spam activé**\n` +
          `• Seuil : **${c.maxMessages}** messages en **${Math.round(c.intervalMs / 1000)}s**\n` +
          `• Mute : ${c.timeoutMs > 0 ? `**${Math.round(c.timeoutMs / 60000)} min**` : 'aucun (suppression seule)'}\n` +
          MULTI_LINE +
          `• Rôles exemptés : ${c.exemptRoleIds?.length ? c.exemptRoleIds.map((r) => `<@&${r}>`).join(' ') : '_aucun_'}\n` +
          ignoredLine(c.ignoredChannelIds) +
          missingPermissions(interaction.guild) +
          STAFF_NOTE,
        ephemeral: true,
      });
    }

    if (sub === 'desactiver') {
      const c = getAntiSpamConfig(guildId) ?? {};
      setAntiSpamConfig(guildId, { ...c, enabled: false });
      return interaction.reply({ content: '🔕 Anti-spam **désactivé**.', ephemeral: true });
    }

    if (sub === 'ignorer') {
      const channel = interaction.options.getChannel('salon', true);
      const prev = getAntiSpamConfig(guildId) ?? {};
      const ignored = prev.ignoredChannelIds ?? [];
      const removing = ignored.includes(channel.id);
      const ignoredChannelIds = removing ? ignored.filter((id) => id !== channel.id) : [...ignored, channel.id];
      setAntiSpamConfig(guildId, { ...prev, ignoredChannelIds });
      const isCategory = channel.type === ChannelType.GuildCategory;
      return interaction.reply({
        content:
          (removing
            ? `✅ ${channel} n’est plus ignoré : l’anti-spam s’y applique de nouveau.\n`
            : `✅ ${channel} est maintenant **ignoré** par l’anti-spam et le multi-salons${isCategory ? ' (tous les salons de cette catégorie)' : ''}.\n`) +
          ignoredLine(ignoredChannelIds) +
          (prev.enabled ? '' : 'ℹ️ L’anti-spam est désactivé : active-le avec `/antispam activer`.'),
        ephemeral: true,
      });
    }

    // activer
    const prev = getAntiSpamConfig(guildId) ?? {};
    const maxMessages = interaction.options.getInteger('messages') ?? prev.maxMessages ?? 5;
    const seconds = interaction.options.getInteger('secondes') ?? Math.round((prev.intervalMs ?? 5000) / 1000);
    const muteMin = interaction.options.getInteger('mute_minutes') ?? Math.round((prev.timeoutMs ?? 300000) / 60000);
    const role = interaction.options.getRole('role_exempt');

    // ...prev : garde les salons ignorés.
    const config = {
      ...prev,
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
        MULTI_LINE +
        `• Rôles exemptés : ${config.exemptRoleIds.length ? config.exemptRoleIds.map((r) => `<@&${r}>`).join(' ') : '_aucun_'}\n` +
        ignoredLine(config.ignoredChannelIds) +
        missingPermissions(interaction.guild) +
        STAFF_NOTE,
      ephemeral: true,
    });
  },
};
