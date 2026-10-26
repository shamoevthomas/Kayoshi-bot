import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../../lib/logger.js';
import { roleCommandProblem } from '../../lib/roles.js';
import { parseDuration, formatDuration } from '../../lib/time.js';
import { getTempRole, setTempRole } from '../../lib/store.js';

const MIN_DURATION = 60_000;
const MAX_DURATION = 365 * 86_400_000;

// Donne un rôle pour une durée : il est retiré automatiquement à la fin (lib/roles.js,
// vérifié toutes les 30 s, même après un redémarrage du bot).
export default {
  data: new SlashCommandBuilder()
    .setName('roletempo')
    .setDescription('Donner un rôle à un membre pour une durée (retiré automatiquement à la fin).')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('Le rôle à donner').setRequired(true))
    .addStringOption((o) =>
      o.setName('duree').setDescription('Durée, ex : 15m, 2h, 3d, 1w (de 1 minute à 1 an)').setRequired(true).setMaxLength(10),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false),

  async execute(interaction) {
    const guild = interaction.guild;
    const target = interaction.options.getUser('membre');
    const role = interaction.options.getRole('role');
    const input = interaction.options.getString('duree', true);
    const member = await guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });

    const parsed = parseDuration(input);
    if (!parsed || parsed.permanent || parsed.ms < MIN_DURATION || parsed.ms > MAX_DURATION) {
      return interaction.reply({
        content: `❌ Durée invalide : \`${input}\`. Exemples : \`15m\`, \`2h\`, \`3d\`, \`1w\` (de 1 minute à 1 an).`,
        ephemeral: true,
      });
    }
    const problem = roleCommandProblem(interaction, role, 'donner');
    if (problem) return interaction.reply({ content: problem, ephemeral: true });

    // Déjà temporaire : la durée repart de maintenant. Déjà permanent : on ne le rend pas temporaire.
    const existing = getTempRole(guild.id, member.id, role.id);
    if (member.roles.cache.has(role.id) && !existing) {
      return interaction.reply({
        content: `↪️ ${target} a déjà le rôle ${role} (sans limite de temps). Retire-le d’abord avec \`/role\` pour le donner temporairement.`,
        ephemeral: true,
      });
    }

    const removeAt = Date.now() + parsed.ms;
    const duration = formatDuration(parsed.ms);
    if (!member.roles.cache.has(role.id)) {
      await member.roles.add(role, `/roletempo (${duration}) par ${interaction.user.tag}`);
    }
    setTempRole(guild.id, { userId: member.id, roleId: role.id, removeAt, by: interaction.user.id });
    const end = Math.floor(removeAt / 1000);

    await sendLog(
      guild,
      new EmbedBuilder()
        .setColor(Colors.role)
        .setAuthor({ name: existing ? '⏳ Rôle temporaire prolongé' : '⏳ Rôle temporaire ajouté' })
        .setDescription(`${role} ${existing ? 'prolongé pour' : 'ajouté à'} ${target}`)
        .addFields(
          { name: 'Durée', value: duration, inline: true },
          { name: 'Fin', value: `<t:${end}:f> (<t:${end}:R>)`, inline: true },
          { name: 'Par', value: `${interaction.user}`, inline: true },
        )
        .setTimestamp(),
    );

    await interaction.reply({
      content: existing
        ? `✅ Rôle temporaire ${role} de ${target} prolongé : il lui sera retiré <t:${end}:R> (<t:${end}:f>).`
        : `✅ ${target} a le rôle ${role} pendant **${duration}** : il lui sera retiré <t:${end}:R> (<t:${end}:f>).`,
      ephemeral: true,
    });
  },
};
