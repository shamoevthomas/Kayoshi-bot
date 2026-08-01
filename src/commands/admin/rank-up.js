import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

const RANKUP_TEXT =
  '# Modérateur\n' +
  'Minimum être niveau 10. (faites `/niveau` pour savoir votre niveau actuel)\n' +
  'Faire `/bump`tout les deux heures dans <#1457396440258183373>  dès qu\'on a la possibilité.\n' +
  'S\'occuper des embrouilles.\n' +
  'Accueillir les nouveaux.\n' +
  '# Animateur\n' +
  'Au moins faire ___une___ animation tout les un mois.\n' +
  'Sanctionner les membres si il y a une embrouille dans le chat d\'un event ou dans une voc.';

export default {
  data: new SlashCommandBuilder()
    .setName('rank-up')
    .setDescription('Envoyer les conditions de montée en grade (Modérateur / Animateur).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.channel.send({ content: RANKUP_TEXT, allowedMentions: { parse: [] } });
    await interaction.reply({ content: '✅ Message envoyé.', ephemeral: true });
  },
};
