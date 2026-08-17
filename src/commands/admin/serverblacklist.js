import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import {
  getServerBlacklist,
  addBlacklistedServer,
  removeBlacklistedServer,
} from '../../lib/store.js';
import { ensureQuarantineRole, botCanManageRoles } from '../../lib/blacklist.js';

export default {
  data: new SlashCommandBuilder()
    .setName('serverblacklist')
    .setDescription('Mettre en quarantaine les nouveaux membres venant de serveurs blacklistés.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('ajouter')
        .setDescription('Blacklister un serveur (par son ID).')
        .addStringOption((o) => o.setName('serveur_id').setDescription('ID du serveur Discord à blacklister').setRequired(true)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('Retirer un serveur de la blacklist.')
        .addStringOption((o) => o.setName('serveur_id').setDescription('ID du serveur à retirer').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Voir les serveurs blacklistés.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'liste') {
      const { serverIds, quarantineRoleId, whitelist } = getServerBlacklist(guildId);
      if (!serverIds.length) return interaction.reply({ content: 'Aucun serveur blacklisté.', ephemeral: true });
      const shared = serverIds.map((id) => {
        const g = interaction.client.guilds.cache.get(id);
        return g ? `• \`${id}\` — ✅ ${g.name} (surveillé)` : `• \`${id}\` — ⚠️ le bot n'est pas dans ce serveur (indétectable)`;
      });
      return interaction.reply({
        content:
          `🚫 **Serveurs blacklistés :**\n${shared.join('\n')}\n\n` +
          `Rôle de quarantaine : ${quarantineRoleId ? `<@&${quarantineRoleId}>` : '_créé au 1er membre détecté_'}\n` +
          `Membres whitelistés : ${whitelist.length}`,
        ephemeral: true,
      });
    }

    const serverId = interaction.options.getString('serveur_id').trim();
    if (!/^\d{17,20}$/.test(serverId)) {
      return interaction.reply({ content: `❌ ID de serveur invalide : \`${serverId}\`.`, ephemeral: true });
    }
    if (serverId === guildId) {
      return interaction.reply({ content: '❌ Tu ne peux pas blacklister ce serveur lui-même.', ephemeral: true });
    }

    if (sub === 'retirer') {
      const ok = removeBlacklistedServer(guildId, serverId);
      return interaction.reply({
        content: ok ? `✅ Serveur \`${serverId}\` retiré de la blacklist.` : `ℹ️ \`${serverId}\` n'était pas blacklisté.`,
        ephemeral: true,
      });
    }

    // ajouter
    if (!botCanManageRoles(interaction.guild)) {
      return interaction.reply({ content: '❌ Il me manque la permission **Gérer les rôles** (nécessaire pour la quarantaine).', ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });
    const added = addBlacklistedServer(guildId, serverId);

    // Prépare le rôle de quarantaine dès maintenant.
    const role = await ensureQuarantineRole(interaction.guild).catch(() => null);
    const shared = interaction.client.guilds.cache.has(serverId);

    return interaction.editReply({
      content:
        (added ? `✅ Serveur \`${serverId}\` ajouté à la blacklist.` : `ℹ️ \`${serverId}\` était déjà blacklisté.`) +
        (role ? `\n🔒 Rôle de quarantaine : ${role}` : '\n⚠️ Impossible de créer/configurer le rôle de quarantaine.') +
        (shared
          ? '\n✅ Je suis dans ce serveur → je pourrai détecter ses membres à leur arrivée.'
          : "\n⚠️ **Je ne suis pas dans ce serveur.** Discord ne me permet pas de savoir qui en fait partie : la détection ne marchera **que si tu m'invites aussi dans ce serveur**."),
    });
  },
};
