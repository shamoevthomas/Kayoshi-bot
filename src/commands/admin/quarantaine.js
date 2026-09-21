import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getServerBlacklist, setServerBlacklistConfig } from '../../lib/store.js';
import { Colors } from '../../lib/logger.js';

// Refuse un rôle que le bot ne pourra pas manipuler : @everyone, rôle géré par
// une intégration, ou rôle placé au-dessus du plus haut rôle du bot.
function roleProblem(guild, role) {
  if (role.id === guild.id) return 'C’est le rôle @everyone.';
  if (role.managed) return 'Ce rôle est géré par une intégration (bot/booster) et ne peut pas être attribué manuellement.';
  const me = guild.members.me;
  if (me && role.position >= me.roles.highest.position) {
    return `Ce rôle est au-dessus du mien — je ne pourrai pas l’attribuer. Descends-le sous mon rôle le plus haut.`;
  }
  return null;
}

export default {
  data: new SlashCommandBuilder()
    .setName('quarantaine')
    .setDescription('Met les nouveaux arrivants en quarantaine (rôle prisonnier).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('config')
        .setDescription('Définir le rôle prisonnier et (optionnel) le rôle membre à retirer.')
        .addRoleOption((o) =>
          o.setName('prisonnier').setDescription('Rôle ajouté à l’arrivée').setRequired(true),
        )
        .addRoleOption((o) =>
          o.setName('membre').setDescription('Rôle retiré à l’arrivée (optionnel)').setRequired(false),
        ),
    )
    .addSubcommand((s) =>
      s.setName('on').setDescription('Activer : tout nouvel arrivant est mis en quarantaine.'),
    )
    .addSubcommand((s) => s.setName('off').setDescription('Désactiver le mode quarantaine.'))
    .addSubcommand((s) => s.setName('statut').setDescription('Voir la configuration actuelle.')),

  async execute(interaction) {
    const guild = interaction.guild;
    const guildId = guild.id;
    const sub = interaction.options.getSubcommand();

    if (sub === 'config') {
      const prisonnier = interaction.options.getRole('prisonnier');
      const membre = interaction.options.getRole('membre');

      const problem = roleProblem(guild, prisonnier);
      if (problem) return interaction.reply({ content: `❌ ${problem}`, ephemeral: true });

      setServerBlacklistConfig(guildId, {
        quarantineRoleId: prisonnier.id,
        memberRoleId: membre?.id ?? null,
      });

      const { enabled } = getServerBlacklist(guildId);
      return interaction.reply({
        content:
          `✅ Rôle prisonnier : ${prisonnier}` +
          (membre ? `\n✅ Rôle membre retiré à l’arrivée : ${membre}` : '\nℹ️ Aucun rôle membre à retirer.') +
          `\n\nMode quarantaine : ${enabled ? '**activé** — les arrivées sont mises en quarantaine.' : '**désactivé** — fais `/quarantaine on` pour l’activer.'}`,
        ephemeral: true,
      });
    }

    if (sub === 'on') {
      const { quarantineRoleId } = getServerBlacklist(guildId);
      if (!quarantineRoleId) {
        return interaction.reply({
          content: '❌ Configure d’abord le rôle prisonnier avec `/quarantaine config`.',
          ephemeral: true,
        });
      }
      setServerBlacklistConfig(guildId, { enabled: true });
      return interaction.reply({
        content:
          '🔒 Mode quarantaine **activé**. Chaque nouvel arrivant reçoit le rôle prisonnier et perd le rôle membre.',
        ephemeral: true,
      });
    }

    if (sub === 'off') {
      setServerBlacklistConfig(guildId, { enabled: false });
      return interaction.reply({
        content:
          '🔓 Mode quarantaine **désactivé**. Les nouveaux arrivants ne sont plus mis en quarantaine automatiquement _(les membres déjà prisonniers gardent leur rôle)_.',
        ephemeral: true,
      });
    }

    // statut
    const { quarantineRoleId, memberRoleId, enabled, sticky } = getServerBlacklist(guildId);
    const embed = new EmbedBuilder()
      .setColor(Colors.role)
      .setTitle('🔒 Mode quarantaine')
      .addFields(
        { name: 'État', value: enabled ? '🟢 Activé' : '⚪ Désactivé', inline: true },
        { name: 'Rôle prisonnier', value: quarantineRoleId ? `<@&${quarantineRoleId}>` : '—', inline: true },
        { name: 'Rôle membre retiré', value: memberRoleId ? `<@&${memberRoleId}>` : '—', inline: true },
        { name: 'Prisonniers mémorisés', value: `${sticky.length}`, inline: true },
      )
      .setFooter({ text: 'Un modo peut libérer un membre en lui retirant simplement le rôle prisonnier.' });
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
