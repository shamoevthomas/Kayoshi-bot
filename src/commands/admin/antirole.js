import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getAntiRoleRules, addAntiRoleRule, removeAntiRoleRule } from '../../lib/store.js';
import { sweepAntiRolesGuild } from '../../lib/antirole.js';

const roleOptions = (sub) =>
  sub
    .addRoleOption((o) => o.setName('role_garde').setDescription('Le rôle prioritaire, que le membre garde (ex : Actif)').setRequired(true))
    .addRoleOption((o) =>
      o.setName('role_retire').setDescription('Le rôle retiré si le membre a le rôle prioritaire (ex : Nouveau)').setRequired(true),
    );

export default {
  data: new SlashCommandBuilder()
    .setName('antirole')
    .setDescription('Rôles incompatibles : si un membre a un rôle, un autre lui est retiré.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) => roleOptions(sub.setName('ajouter').setDescription('Ajouter une règle (ex : Actif retire Nouveau).')))
    .addSubcommand((sub) => roleOptions(sub.setName('retirer').setDescription('Supprimer une règle.')))
    .addSubcommand((sub) => sub.setName('liste').setDescription('Voir les règles configurées.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === 'liste') {
      const rules = getAntiRoleRules(guild.id);
      if (!rules.length) return interaction.reply({ content: 'Aucune règle antirole configurée.', ephemeral: true });
      const lines = rules.map((r) => `• <@&${r.keepRoleId}> → retire <@&${r.removeRoleId}>`);
      return interaction.reply({ content: `🚫 **Rôles incompatibles :**\n${lines.join('\n')}`, ephemeral: true });
    }

    const keep = interaction.options.getRole('role_garde');
    const remove = interaction.options.getRole('role_retire');

    if (sub === 'retirer') {
      const ok = removeAntiRoleRule(guild.id, keep.id, remove.id);
      return interaction.reply({
        content: ok ? `✅ Règle supprimée : ${keep} ne retire plus ${remove}.` : `ℹ️ Aucune règle ${keep} → ${remove}.`,
        ephemeral: true,
      });
    }

    // ajouter
    const me = guild.members.me;
    if (keep.id === remove.id) {
      return interaction.reply({ content: '❌ Choisis deux rôles différents.', ephemeral: true });
    }
    if (keep.id === guild.id || remove.id === guild.id) {
      return interaction.reply({ content: '❌ Impossible d’utiliser @everyone.', ephemeral: true });
    }
    if (remove.managed) {
      return interaction.reply({ content: `❌ Le rôle ${remove} est géré par une intégration, je ne peux pas le retirer.`, ephemeral: true });
    }
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: '❌ Il me manque la permission **Gérer les rôles**.', ephemeral: true });
    }
    if (remove.position >= me.roles.highest.position) {
      return interaction.reply({ content: `❌ Le rôle ${remove} est au-dessus de mon rôle le plus haut. Déplace mon rôle plus haut.`, ephemeral: true });
    }
    if (getAntiRoleRules(guild.id).some((r) => r.keepRoleId === remove.id && r.removeRoleId === keep.id)) {
      return interaction.reply({
        content: `❌ La règle inverse existe déjà (${remove} retire ${keep}). Supprime-la d’abord avec \`/antirole retirer\`.`,
        ephemeral: true,
      });
    }
    if (!addAntiRoleRule(guild.id, keep.id, remove.id)) {
      return interaction.reply({ content: `ℹ️ La règle ${keep} → ${remove} existe déjà.`, ephemeral: true });
    }

    // Applique tout de suite aux membres qui ont déjà les deux rôles.
    await interaction.deferReply({ ephemeral: true });
    const removed = await sweepAntiRolesGuild(guild).catch(() => 0);
    return interaction.editReply({
      content:
        `✅ Règle ajoutée : un membre qui a ${keep} ne peut plus avoir ${remove} (il lui est retiré automatiquement).` +
        (removed ? `\n🧹 ${remove} retiré à **${removed}** membre(s) qui avaient déjà les deux.` : ''),
    });
  },
};
