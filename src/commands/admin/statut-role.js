import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getStatusRoleConfig, setStatusRoleConfig } from '../../lib/store.js';
import { sweepAutoRolesGuild, reconcileAutoRoles } from '../../lib/autoroles.js';
import { lastPresenceSeen } from '../../events/presenceUpdate.js';

export default {
  data: new SlashCommandBuilder()
    .setName('statut-role')
    .setDescription('Donner un rôle aux membres qui ont un texte (ex: une invite) dans leur statut.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('activer')
        .setDescription('Configurer le texte à détecter dans le statut et le rôle à donner.')
        .addStringOption((opt) =>
          opt
            .setName('texte')
            .setDescription('Texte à détecter dans le statut (ex: .gg/ichima)')
            .setRequired(true),
        )
        .addRoleOption((opt) =>
          opt.setName('role').setDescription('Rôle à donner aux membres concernés').setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName('desactiver').setDescription('Désactiver le rôle automatique lié au statut.'),
    )
    .addSubcommand((sub) => sub.setName('voir').setDescription('Voir la configuration actuelle.'))
    .addSubcommand((sub) =>
      sub
        .setName('tester')
        .setDescription('Diagnostiquer pourquoi un membre ne reçoit pas (ou reçoit) le rôle.')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre à vérifier').setRequired(true)),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'tester') {
      const config = getStatusRoleConfig(interaction.guild.id);
      if (!config?.text || !config.roleId) {
        return interaction.reply({ content: 'ℹ️ Aucun rôle-statut configuré. Utilise `/statut-role activer`.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      const targetId = interaction.options.getUser('membre').id;
      // La présence est tenue à jour en direct par l'événement presenceUpdate : on lit le cache.
      const member =
        interaction.guild.members.cache.get(targetId) ?? (await interaction.guild.members.fetch(targetId).catch(() => null));
      if (!member) return interaction.editReply({ content: '❌ Membre introuvable sur le serveur.' });

      // Ce que le bot lit du statut (statut personnalisé uniquement — pas la bio « À propos de moi »).
      const activities = member.presence?.activities ?? [];
      const statusText = activities
        .flatMap((a) => [a.state, a.details, a.name].filter(Boolean))
        .join(' ');
      const seen = statusText || null;
      // Détail brut de ce que le bot reçoit (pour repérer un cache périmé ou un texte ailleurs).
      const raw = activities.length
        ? activities.map((a) => `type ${a.type}${a.name ? ` « ${a.name} »` : ''}${a.state ? ` · state: \`${a.state}\`` : ''}${a.emoji ? ` · emoji ${a.emoji.name}` : ''}`).join('\n   ')
        : '(aucune activité reçue)';
      const keyword = config.text.toLowerCase();
      const matches = Boolean(seen && seen.toLowerCase().includes(keyword));
      const role = interaction.guild.roles.cache.get(config.roleId);
      const me = interaction.guild.members.me;
      const hasRole = member.roles.cache.has(config.roleId);

      const clientStatus = member.presence?.clientStatus ? Object.keys(member.presence.clientStatus).join(', ') : 'aucun';
      const checks = [];
      checks.push(`• Texte configuré : \`${config.text}\` → rôle ${role ?? '`(rôle supprimé)`'}`);
      checks.push(member.presence ? `✅ Présence vue par le bot : **${member.presence.status}** (appareil : ${clientStatus})` : '❌ Présence **invisible** : le membre est hors ligne/invisible, ou l’intent Présence est coupé');
      checks.push(seen ? `📄 Statut personnalisé lu : \`${seen}\`` : '❌ **Aucun statut personnalisé** lu — le texte est peut-être dans la bio « À propos de moi » (illisible par les bots), ou le statut n’est pas synchronisé');
      checks.push(`🧩 Activités reçues (${activities.length}) : ${raw}`);
      // Dernier changement de présence reçu en direct (prouve que le circuit presenceUpdate marche).
      const last = lastPresenceSeen.get(`${interaction.guild.id}:${targetId}`);
      checks.push(
        last
          ? `📡 Dernier changement de présence reçu <t:${Math.floor(last.at / 1000)}:R> (${last.count} activité(s)${last.text ? `, texte : \`${last.text}\`` : ''})`
          : '📡 **Aucun changement de présence reçu** depuis le démarrage du bot pour ce membre — Discord n’envoie pas ses mises à jour de statut au bot',
      );
      checks.push(matches ? '✅ Le statut **contient** le texte configuré' : '❌ Le statut ne contient pas le texte configuré');
      if (!role) checks.push('❌ Le rôle configuré n’existe plus — refais `/statut-role activer`');
      else {
        if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) checks.push('❌ Il me manque la permission **Gérer les rôles**');
        if (role.position >= me.roles.highest.position) checks.push(`❌ ${role} est **au-dessus** de mon rôle le plus haut : je ne peux pas le donner`);
      }
      checks.push(hasRole ? 'ℹ️ Le membre a **déjà** le rôle' : 'ℹ️ Le membre n’a pas le rôle');

      const verdict = matches && role && !hasRole && me.permissions.has(PermissionFlagsBits.ManageRoles) && role.position < me.roles.highest.position
        ? '\n\n➡️ Tout est bon : je vais lui donner le rôle maintenant.'
        : matches && hasRole
          ? '\n\n➡️ Le membre correspond et a déjà le rôle.'
          : '\n\n➡️ Corrige le point marqué ❌ ci-dessus.';

      // Applique la réconciliation (donne/retire le rôle selon le statut réel).
      await reconcileAutoRoles(member).catch(() => {});
      return interaction.editReply({ content: `🔎 **Diagnostic rôle-statut pour ${member}**\n${checks.join('\n')}${verdict}`, allowedMentions: { parse: [] } });
    }

    if (sub === 'voir') {
      const config = getStatusRoleConfig(interaction.guild.id);
      if (!config?.text || !config.roleId) {
        return interaction.reply({ content: 'ℹ️ Aucun rôle-statut configuré. Utilise `/statut-role activer`.', ephemeral: true });
      }
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setAuthor({ name: '📡 Rôle selon le statut' })
        .addFields(
          { name: 'Texte détecté', value: `\`${config.text}\``, inline: true },
          { name: 'Rôle attribué', value: `<@&${config.roleId}>`, inline: true },
        )
        .setFooter({ text: 'Le membre reçoit le rôle tant que le texte est dans son statut.' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'desactiver') {
      setStatusRoleConfig(interaction.guild.id, null);
      return interaction.reply({ content: '✅ Rôle-statut désactivé. (Les rôles déjà donnés ne sont pas retirés.)', ephemeral: true });
    }

    // sub === 'activer'
    const texte = interaction.options.getString('texte').trim();
    const role = interaction.options.getRole('role');

    if (role.managed || role.id === interaction.guild.id) {
      return interaction.reply({ content: '❌ Ce rôle ne peut pas être attribué (rôle géré par une intégration ou @everyone).', ephemeral: true });
    }
    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: '❌ Il me manque la permission **Gérer les rôles**.', ephemeral: true });
    }
    if (role.position >= me.roles.highest.position) {
      return interaction.reply({ content: `❌ Mon rôle doit être **au-dessus** de ${role} dans la liste des rôles.`, ephemeral: true });
    }

    setStatusRoleConfig(interaction.guild.id, { text: texte, roleId: role.id });

    await interaction.reply({
      content: `✅ C'est configuré : tout membre avec \`${texte}\` dans son statut recevra ${role}.\n⏳ Application aux membres déjà en ligne…`,
      ephemeral: true,
    });

    // Applique immédiatement aux membres déjà en ligne (réconciliation unifiée).
    await sweepAutoRolesGuild(interaction.guild).catch(() => {});
    await interaction.editReply({
      content: `✅ C'est configuré : tout membre avec \`${texte}\` dans son statut recevra ${role}.`,
    }).catch(() => {});
  },
};
