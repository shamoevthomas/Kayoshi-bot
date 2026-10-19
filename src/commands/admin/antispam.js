import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getAntiSpamConfig, setAntiSpamConfig } from '../../lib/store.js';
import { MULTI_WINDOW_MS, MULTI_SAME_CHANNELS, MULTI_MIN_CHANNELS, MULTI_TIMEOUT_MS } from '../../lib/antispam.js';

// Règle fixe, active avec l'anti-spam.
const MULTI_LINE =
  `• Multi-salons : le même message dans **${MULTI_SAME_CHANNELS}** salons, ou des messages dans **${MULTI_MIN_CHANNELS}** salons, ` +
  `en **${MULTI_WINDOW_MS / 1000}s** → mute **${MULTI_TIMEOUT_MS / 3_600_000} h**\n`;

const STAFF_NOTE =
  '_Le staff (« Gérer les messages ») est toujours exempté : pour tester, utilise un compte sans cette permission._';

// Salons que /antispam activer peut faire ignorer (une catégorie = tous ses salons).
const IGNORABLE_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildVoice,
  ChannelType.GuildForum,
  ChannelType.GuildCategory,
];

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
        .addRoleOption((o) => o.setName('role_exempt').setDescription('(Facultatif) rôle exempté de l’anti-spam'))
        .addChannelOption((o) =>
          o
            .setName('ignorer')
            .setDescription('(Facultatif) Salon ou catégorie que l’anti-spam doit ignorer')
            .addChannelTypes(...IGNORABLE_TYPES),
        )
        .addChannelOption((o) =>
          o
            .setName('ne_plus_ignorer')
            .setDescription('(Facultatif) Salon ou catégorie à ne plus ignorer')
            .addChannelTypes(...IGNORABLE_TYPES),
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

    // activer
    const prev = getAntiSpamConfig(guildId) ?? {};
    const maxMessages = interaction.options.getInteger('messages') ?? prev.maxMessages ?? 5;
    const seconds = interaction.options.getInteger('secondes') ?? Math.round((prev.intervalMs ?? 5000) / 1000);
    const muteMin = interaction.options.getInteger('mute_minutes') ?? Math.round((prev.timeoutMs ?? 300000) / 60000);
    const role = interaction.options.getRole('role_exempt');

    // Salons ignorés : la liste actuelle, moins « ne_plus_ignorer », plus « ignorer ».
    const toIgnore = interaction.options.getChannel('ignorer');
    const toWatch = interaction.options.getChannel('ne_plus_ignorer');
    let ignoredChannelIds = (prev.ignoredChannelIds ?? []).filter((id) => id !== toWatch?.id);
    if (toIgnore && !ignoredChannelIds.includes(toIgnore.id)) ignoredChannelIds = [...ignoredChannelIds, toIgnore.id];
    const changes = [];
    if (toWatch && toWatch.id !== toIgnore?.id) changes.push(`✅ ${toWatch} n’est plus ignoré.`);
    if (toIgnore) {
      changes.push(
        `✅ ${toIgnore} est **ignoré** par l’anti-spam et le multi-salons` +
          `${toIgnore.type === ChannelType.GuildCategory ? ' (tous les salons de cette catégorie)' : ''}.`,
      );
    }

    // ...prev : garde les réglages non modifiés.
    const config = {
      ...prev,
      enabled: true,
      maxMessages,
      intervalMs: seconds * 1000,
      timeoutMs: muteMin * 60000,
      exemptRoleIds: role ? [role.id] : prev.exemptRoleIds ?? [],
      ignoredChannelIds,
    };
    setAntiSpamConfig(guildId, config);

    return interaction.reply({
      content:
        (changes.length ? `${changes.join('\n')}\n` : '') +
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
