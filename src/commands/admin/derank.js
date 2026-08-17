import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../../lib/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('derank')
    .setDescription('Retirer un rôle à un membre et le prévenir en message privé.')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre à derank').setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('Le rôle à retirer').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('La raison du derank').setRequired(true))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false),

  async execute(interaction) {
    const target = interaction.options.getUser('membre');
    const role = interaction.options.getRole('role');
    const reason = interaction.options.getString('raison');

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });

    // Hiérarchie / validité du rôle.
    const me = interaction.guild.members.me;
    if (role.id === interaction.guild.id) {
      return interaction.reply({ content: '❌ Impossible de retirer le rôle @everyone.', ephemeral: true });
    }
    if (role.managed) {
      return interaction.reply({ content: '❌ Ce rôle est géré par une intégration, impossible de le retirer manuellement.', ephemeral: true });
    }
    if (role.position >= me.roles.highest.position) {
      return interaction.reply({ content: `❌ Le rôle ${role} est au-dessus de mon rôle le plus haut, je ne peux pas le gérer.`, ephemeral: true });
    }
    if (!member.roles.cache.has(role.id)) {
      return interaction.reply({ content: `ℹ️ ${target} n'a pas le rôle ${role}.`, ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    // MP AVANT le retrait (le membre pourrait devenir injoignable sinon).
    let dmSent = true;
    await target
      .send(
        `Bonjour ${target.username}, vous avez été derank de **${interaction.guild.name}** ` +
          `pour la raison suivante : ${reason}`,
      )
      .catch(() => {
        dmSent = false;
      });

    try {
      await member.roles.remove(role, `Derank par ${interaction.user.tag} : ${reason}`);
    } catch (err) {
      console.error('[derank] échec :', err);
      return interaction.editReply({ content: `❌ Impossible de retirer le rôle : ${err?.message ?? 'erreur inconnue'}` });
    }

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.role)
        .setAuthor({ name: '⬇️ Derank' })
        .setDescription(`${role} retiré à ${target} (${target.tag})`)
        .addFields(
          { name: 'Raison', value: reason },
          { name: 'Par', value: `${interaction.user}`, inline: true },
          { name: 'MP envoyé', value: dmSent ? '✅ oui' : '❌ non (MP fermés)', inline: true },
        )
        .setTimestamp(),
    );

    return interaction.editReply({
      content:
        `✅ ${target} a été derank du rôle ${role}.` +
        (dmSent ? '' : "\n⚠️ Je n'ai pas pu lui envoyer de MP (messages privés fermés)."),
    });
  },
};
