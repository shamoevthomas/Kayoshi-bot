import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getStatConfig, setStatConfig } from '../../lib/store.js';
import { postStatMessage } from '../../lib/activity.js';

// Valide qu'un rôle récompense est attribuable par le bot. Renvoie un message d'erreur ou null.
function checkRole(guild, role) {
  if (!role) return null;
  if (role.id === guild.id) return '❌ Impossible d’utiliser @everyone comme rôle récompense.';
  if (role.managed) return `❌ Le rôle ${role} est géré par une intégration et ne peut pas être attribué.`;
  const me = guild.members.me;
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) return '❌ Il me manque la permission **Gérer les rôles**.';
  if (role.position >= me.roles.highest.position) return `❌ Le rôle ${role} est au-dessus de mon rôle le plus haut. Déplace mon rôle plus haut.`;
  return null;
}

export default {
  data: new SlashCommandBuilder()
    .setName('configstat')
    .setDescription('Choisir le salon du classement des membres les plus actifs de la semaine.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addChannelOption((o) =>
      o
        .setName('salon')
        .setDescription('Salon où afficher le classement (actualisé toutes les 10 min)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    )
    .addRoleOption((o) =>
      o.setName('role_messages').setDescription('(Facultatif) rôle donné au 1er en messages'),
    )
    .addRoleOption((o) =>
      o.setName('role_vocal').setDescription('(Facultatif) rôle donné au 1er en vocal'),
    ),

  async execute(interaction) {
    const channel = interaction.options.getChannel('salon');
    const textRole = interaction.options.getRole('role_messages');
    const voiceRole = interaction.options.getRole('role_vocal');
    const me = interaction.guild.members.me;

    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms.has(PermissionFlagsBits.EmbedLinks)) {
      return interaction.reply({
        content: `❌ Il me faut les permissions **Envoyer des messages** et **Intégrer des liens** dans ${channel}.`,
        ephemeral: true,
      });
    }
    const roleErr = checkRole(interaction.guild, textRole) || checkRole(interaction.guild, voiceRole);
    if (roleErr) return interaction.reply({ content: roleErr, ephemeral: true });

    await interaction.deferReply({ ephemeral: true });

    // Supprime l'ancien message de classement s'il en existait un.
    const old = getStatConfig(interaction.guild.id);
    if (old?.channelId && old.messageId) {
      const oldChan =
        interaction.guild.channels.cache.get(old.channelId) ??
        (await interaction.guild.channels.fetch(old.channelId).catch(() => null));
      const oldMsg = oldChan?.isTextBased?.() ? await oldChan.messages.fetch(old.messageId).catch(() => null) : null;
      await oldMsg?.delete().catch(() => {});
    }

    const messageId = await postStatMessage(interaction.guild, channel).catch((err) => {
      console.error('[configstat] envoi échoué :', err);
      return null;
    });
    if (!messageId) {
      return interaction.editReply({ content: `❌ Impossible d'envoyer le message dans ${channel}.` });
    }

    setStatConfig(interaction.guild.id, {
      channelId: channel.id,
      messageId,
      textRoleId: textRole?.id ?? null,
      voiceRoleId: voiceRole?.id ?? null,
      textTopId: null,
      voiceTopId: null,
    });

    const roleInfo =
      (textRole ? `\n💬 1er en messages → ${textRole}` : '') +
      (voiceRole ? `\n🔊 1er en vocal → ${voiceRole}` : '');
    return interaction.editReply({
      content:
        `✅ Classement des plus actifs configuré dans ${channel}.\n` +
        `Il se met à jour **toutes les 10 minutes** et se réinitialise chaque **lundi**.` +
        roleInfo,
    });
  },
};
