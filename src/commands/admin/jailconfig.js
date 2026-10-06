import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { setJailConfig } from '../../lib/store.js';
import { jailRoleProblem } from '../../lib/jail.js';

export default {
  data: new SlashCommandBuilder()
    .setName('jailconfig')
    .setDescription('Configurer /jail : le rôle donné et le rôle retiré au membre jail.')
    .addRoleOption((o) => o.setName('role_ajouter').setDescription('Le rôle donné au membre jail (ex : Jail)').setRequired(true))
    .addRoleOption((o) => o.setName('role_retirer').setDescription('Le rôle retiré au membre jail (ex : Membre)').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const add = interaction.options.getRole('role_ajouter');
    const remove = interaction.options.getRole('role_retirer');

    if (add.id === remove.id) return interaction.reply({ content: '❌ Choisis deux rôles différents.', ephemeral: true });
    const problem = jailRoleProblem(interaction.guild, add) ?? jailRoleProblem(interaction.guild, remove);
    if (problem) return interaction.reply({ content: problem, ephemeral: true });

    setJailConfig(interaction.guild.id, { addRoleId: add.id, removeRoleId: remove.id });
    await interaction.reply({
      content: `✅ Jail configuré : avec \`/jail\`, le membre perd ${remove} et gagne ${add}. \`/unjail\` fait l’inverse.`,
      ephemeral: true,
    });
  },
};
