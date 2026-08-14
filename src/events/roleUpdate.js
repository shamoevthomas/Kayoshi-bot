import { Events, EmbedBuilder, AuditLogEvent } from 'discord.js';
import { sendLog, Colors, findExecutor } from '../lib/logger.js';

// Noms FR des permissions de rôle les plus courantes (repli sur le nom brut sinon).
const permLabels = {
  Administrator: 'Administrateur',
  ManageGuild: 'Gérer le serveur',
  ManageRoles: 'Gérer les rôles',
  ManageChannels: 'Gérer les salons',
  ManageMessages: 'Gérer les messages',
  ManageNicknames: 'Gérer les pseudos',
  ManageWebhooks: 'Gérer les webhooks',
  ManageEmojisAndStickers: 'Gérer emojis/stickers',
  ManageEvents: 'Gérer les événements',
  ManageThreads: 'Gérer les fils',
  KickMembers: 'Expulser des membres',
  BanMembers: 'Bannir des membres',
  ModerateMembers: 'Exclure temporairement',
  ViewAuditLog: "Voir les journaux d'audit",
  ViewChannel: 'Voir les salons',
  ViewGuildInsights: 'Voir les statistiques',
  MentionEveryone: 'Mentionner @everyone',
  SendMessages: 'Envoyer des messages',
  SendMessagesInThreads: 'Écrire dans les fils',
  CreatePublicThreads: 'Créer des fils publics',
  CreatePrivateThreads: 'Créer des fils privés',
  EmbedLinks: 'Intégrer des liens',
  AttachFiles: 'Joindre des fichiers',
  AddReactions: 'Ajouter des réactions',
  UseExternalEmojis: 'Émojis externes',
  ReadMessageHistory: "Voir l'historique",
  UseApplicationCommands: 'Utiliser les commandes',
  Connect: 'Se connecter',
  Speak: 'Parler',
  Stream: 'Partager sa vidéo',
  MuteMembers: 'Rendre muet',
  DeafenMembers: 'Rendre sourd',
  MoveMembers: 'Déplacer des membres',
  PrioritySpeaker: 'Voix prioritaire',
  CreateInstantInvite: 'Créer une invitation',
  ChangeNickname: 'Changer son pseudo',
};
const label = (p) => permLabels[p] ?? p;

export default {
  name: Events.GuildRoleUpdate,
  async execute(oldRole, newRole) {
    if (!newRole.guild) return;

    const fields = [];
    if (oldRole.name !== newRole.name) {
      fields.push({ name: 'Nom', value: `\`${oldRole.name}\` → \`${newRole.name}\``, inline: false });
    }
    if (oldRole.hexColor !== newRole.hexColor) {
      fields.push({ name: '🎨 Couleur', value: `\`${oldRole.hexColor}\` → \`${newRole.hexColor}\``, inline: false });
    }
    if (oldRole.hoist !== newRole.hoist) {
      fields.push({ name: 'Affiché séparément', value: newRole.hoist ? 'Oui' : 'Non', inline: true });
    }
    if (oldRole.mentionable !== newRole.mentionable) {
      fields.push({ name: 'Mentionnable', value: newRole.mentionable ? 'Oui' : 'Non', inline: true });
    }

    // Différence de permissions.
    const oldPerms = oldRole.permissions.toArray();
    const newPerms = newRole.permissions.toArray();
    const added = newPerms.filter((p) => !oldPerms.includes(p));
    const removed = oldPerms.filter((p) => !newPerms.includes(p));
    if (added.length || removed.length) {
      const parts = [];
      if (added.length) parts.push(`✅ ${added.map(label).join(', ')}`);
      if (removed.length) parts.push(`⛔ ${removed.map(label).join(', ')}`);
      let value = parts.join('\n');
      if (value.length > 1024) value = value.slice(0, 1000) + '\n… (tronqué)';
      fields.push({ name: 'Permissions modifiées', value, inline: false });
    }

    // Aucun changement pertinent (position, icône…) → on ignore.
    if (!fields.length) return;

    const executor = await findExecutor(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);

    const embed = new EmbedBuilder()
      .setColor(newRole.color || Colors.role)
      .setAuthor({ name: '🔧 Rôle modifié' })
      .setDescription(`${newRole} (**${newRole.name}**)`)
      .addFields(fields)
      .setTimestamp();

    if (executor) embed.addFields({ name: 'Par', value: `${executor}`, inline: true });
    await sendLog(newRole.guild, embed);
  },
};
