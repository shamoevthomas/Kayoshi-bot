import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getAntiNuke, setAntiNuke, LIMITS, DANGEROUS } from '../../lib/antinuke.js';

// Réglages de l'anti-nuke (voir lib/antinuke.js). Seul le propriétaire du serveur peut les changer :
// un admin malveillant ne peut pas le couper avant d'agir.
export default {
  data: new SlashCommandBuilder()
    .setName('antinuke')
    .setDescription('Protection contre les suppressions, bans et expulsions en masse (propriétaire du serveur).')
    .addSubcommand((s) => s.setName('voir').setDescription('État, limites et membres de confiance.'))
    .addSubcommand((s) => s.setName('activer').setDescription('Activer l’anti-nuke.'))
    .addSubcommand((s) => s.setName('desactiver').setDescription('Désactiver l’anti-nuke.'))
    .addSubcommand((s) =>
      s
        .setName('ajouter')
        .setDescription('Ajouter un membre de confiance (jamais sanctionné).')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre de confiance').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('retirer')
        .setDescription('Retirer un membre de confiance.')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true)),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const { guild, user } = interaction;
    const sub = interaction.options.getSubcommand();
    const cfg = getAntiNuke(guild.id);
    const reply = (content) => interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } });

    if (sub === 'voir') {
      // Membres qui pourraient agir en masse et qui ne sont pas de confiance.
      await guild.members.fetch().catch(() => {});
      const watched = guild.members.cache.filter(
        (m) => !m.user.bot && m.id !== guild.ownerId && !cfg.trusted.includes(m.id) && DANGEROUS.some((p) => m.permissions.has(p)),
      );
      const embed = new EmbedBuilder()
        .setColor(cfg.enabled ? 0x2ecc71 : 0x95a5a6)
        .setTitle(`🛡️ Anti-nuke : ${cfg.enabled ? 'activé' : 'désactivé'}`)
        .setDescription(
          'En moins d’une minute, à partir de :\n' +
            Object.values(LIMITS).map((l) => `• **${l.max}** ${l.label}`).join('\n') +
            '\n\n➡️ Ses rôles sont retirés (un bot est expulsé), et le propriétaire est prévenu en MP et dans les logs.',
        )
        .addFields(
          { name: '👑 Jamais sanctionnés', value: `<@${guild.ownerId}> (propriétaire), le bot${cfg.trusted.length ? `, ${cfg.trusted.map((id) => `<@${id}>`).join(', ')}` : ''}` },
          { name: `👀 Surveillés (${watched.size})`, value: watched.size ? watched.map((m) => `${m}`).join(', ').slice(0, 1024) : '_Personne d’autre n’a de permission dangereuse._' },
        )
        .setFooter({ text: 'Seul le propriétaire du serveur peut changer ces réglages.' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (user.id !== guild.ownerId) return reply('❌ Seul le propriétaire du serveur peut changer les réglages de l’anti-nuke.');
    if (sub === 'activer' || sub === 'desactiver') {
      setAntiNuke(guild.id, { enabled: sub === 'activer' });
      return reply(sub === 'activer' ? '✅ Anti-nuke activé.' : '⏹️ Anti-nuke désactivé.');
    }
    const target = interaction.options.getUser('membre', true);
    if (sub === 'ajouter') {
      if (target.bot) return reply('❌ Pas de bot dans les membres de confiance : un bot ajouté par un pirate serait alors protégé.');
      if (cfg.trusted.includes(target.id)) return reply(`ℹ️ ${target} est déjà de confiance.`);
      setAntiNuke(guild.id, { trusted: [...cfg.trusted, target.id] });
      return reply(`✅ ${target} est de confiance : l’anti-nuke ne le sanctionnera jamais.`);
    }
    if (!cfg.trusted.includes(target.id)) return reply(`ℹ️ ${target} n’était pas de confiance.`);
    setAntiNuke(guild.id, { trusted: cfg.trusted.filter((id) => id !== target.id) });
    return reply(`✅ ${target} n’est plus de confiance.`);
  },
};
