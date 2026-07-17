import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('nick')
    .setDescription('Changer ou réinitialiser le pseudo d’un membre.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addStringOption((o) => o.setName('pseudo').setDescription('Nouveau pseudo (vide = réinitialiser)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const nick = interaction.options.getString('pseudo');
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
    if (!member.manageable) return interaction.reply({ content: '❌ Je ne peux pas modifier ce membre (rôle trop haut).', ephemeral: true });

    await member.setNickname(nick ?? null, `Pseudo modifié par ${interaction.user.tag}`);
    await interaction.reply({
      content: nick ? `✅ Pseudo de ${target} changé en **${nick}**.` : `✅ Pseudo de ${target} réinitialisé.`,
      ephemeral: true,
    });
  },
};
