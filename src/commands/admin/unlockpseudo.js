import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { removeNickLock } from '../../lib/store.js';

export default {
  data: new SlashCommandBuilder()
    .setName('unlockpseudo')
    .setDescription('Rendre à un membre le droit de changer son pseudo.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const ok = removeNickLock(interaction.guild.id, target.id);
    await interaction.reply({
      content: ok
        ? `🔓 Pseudo de ${target} déverrouillé : il peut de nouveau se renommer.`
        : `ℹ️ Le pseudo de ${target} n’est pas verrouillé.`,
      ephemeral: true,
    });
  },
};
