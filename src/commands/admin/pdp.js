import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';

const PDP_TEXT =
  '-Lire les <#1513867537388011651> et les respecter.\n' +
  '-Prendre <#1496847450391187497> et envoyer dans votre salon dédié au partenariat et envoyé un screen avec mention visible\n' +
  '-Envoyer sa pub à un membres du <@&1458513415986352300> en MP.';

export default {
  data: new SlashCommandBuilder()
    .setName('pdp')
    .setDescription('Envoyer les consignes de partenariat dans ce salon.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false),

  async execute(interaction) {
    await interaction.channel.send({ content: PDP_TEXT, allowedMentions: { parse: [] } });
    await interaction.reply({ content: '✅ Consignes envoyées.', ephemeral: true });
  },
};
