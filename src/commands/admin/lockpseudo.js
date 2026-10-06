import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { setNickLock } from '../../lib/store.js';

export default {
  data: new SlashCommandBuilder()
    .setName('lockpseudo')
    .setDescription('Imposer un pseudo à un membre : il ne pourra plus se renommer (sauf staff).')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption((o) => o.setName('pseudo').setDescription('Le pseudo imposé').setRequired(true).setMaxLength(32))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const nick = interaction.options.getString('pseudo').trim();
    if (!nick) return interaction.reply({ content: '❌ Le pseudo ne peut pas être vide.', ephemeral: true });

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageNicknames)) {
      return interaction.reply({ content: '❌ Il me manque la permission **Gérer les pseudos**.', ephemeral: true });
    }
    if (!member.manageable) return interaction.reply({ content: '❌ Je ne peux pas modifier ce membre (rôle trop haut).', ephemeral: true });

    const ok = await member
      .setNickname(nick, `Pseudo verrouillé par ${interaction.user.tag}`)
      .then(() => true)
      .catch(() => false);
    if (!ok) return interaction.reply({ content: '❌ Impossible de changer le pseudo de ce membre.', ephemeral: true });

    setNickLock(interaction.guild.id, member.id, { nick, by: interaction.user.id, at: Date.now() });
    await interaction.reply({
      content: `🔒 Pseudo de ${target} verrouillé sur **${nick}** : il ne peut plus se renommer (\`/unlockpseudo\` pour le libérer).`,
      ephemeral: true,
    });
  },
};
