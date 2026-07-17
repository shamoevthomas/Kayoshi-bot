import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Envoyer un message encadré (embed) dans ce salon.')
    .addStringOption((o) => o.setName('titre').setDescription('Titre de l’embed').setRequired(true))
    .addStringOption((o) => o.setName('description').setDescription('Texte principal (utilise \\n pour un saut de ligne)').setRequired(true))
    .addStringOption((o) => o.setName('couleur').setDescription('Couleur hex, ex: #5865F2'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false),

  async execute(interaction) {
    const titre = interaction.options.getString('titre');
    const description = interaction.options.getString('description').replaceAll('\\n', '\n');
    const couleur = interaction.options.getString('couleur');

    const embed = new EmbedBuilder().setTitle(titre).setDescription(description).setColor(0x5865f2);
    if (couleur && /^#?[0-9a-fA-F]{6}$/.test(couleur)) {
      embed.setColor(parseInt(couleur.replace('#', ''), 16));
    }

    await interaction.channel.send({ embeds: [embed] });
    await interaction.reply({ content: '✅ Embed envoyé.', ephemeral: true });
  },
};
