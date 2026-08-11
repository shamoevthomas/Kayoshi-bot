import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';

const CIBLES = [
  { name: 'Tout le monde', value: 'all' },
  { name: 'Tous les humains', value: 'humans' },
  { name: 'Tous les bots', value: 'bots' },
  { name: 'Ceux qui ont un rôle précis', value: 'role' },
];

function matchesTarget(member, cible, filterRoleId) {
  if (cible === 'all') return true;
  if (cible === 'humans') return !member.user.bot;
  if (cible === 'bots') return member.user.bot;
  if (cible === 'role') return filterRoleId ? member.roles.cache.has(filterRoleId) : false;
  return false;
}

export default {
  data: new SlashCommandBuilder()
    .setName('massrole')
    .setDescription('Donner ou retirer un rôle à un ensemble de membres.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('donner')
        .setDescription('Donner un rôle à plusieurs membres.')
        .addRoleOption((o) => o.setName('role').setDescription('Le rôle à donner').setRequired(true))
        .addStringOption((o) =>
          o.setName('cible').setDescription('À qui donner le rôle').setRequired(true).addChoices(...CIBLES),
        )
        .addRoleOption((o) =>
          o.setName('role_filtre').setDescription('(Cible "rôle précis") le rôle que les membres doivent déjà avoir'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('Retirer un rôle à plusieurs membres.')
        .addRoleOption((o) => o.setName('role').setDescription('Le rôle à retirer').setRequired(true))
        .addStringOption((o) =>
          o.setName('cible').setDescription('À qui retirer le rôle').setRequired(true).addChoices(...CIBLES),
        )
        .addRoleOption((o) =>
          o.setName('role_filtre').setDescription('(Cible "rôle précis") le rôle que les membres doivent déjà avoir'),
        ),
    ),

  async execute(interaction) {
    const mode = interaction.options.getSubcommand(); // 'donner' | 'retirer'
    const role = interaction.options.getRole('role');
    const cible = interaction.options.getString('cible');
    const filterRole = interaction.options.getRole('role_filtre');

    // Validations sur le rôle ciblé.
    if (role.id === interaction.guild.id) {
      return interaction.reply({ content: '❌ Impossible de gérer le rôle @everyone.', ephemeral: true });
    }
    if (role.managed) {
      return interaction.reply({ content: '❌ Ce rôle est géré par une intégration et ne peut pas être attribué manuellement.', ephemeral: true });
    }
    const me = interaction.guild.members.me;
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: '❌ Il me manque la permission **Gérer les rôles**.', ephemeral: true });
    }
    if (role.position >= me.roles.highest.position) {
      return interaction.reply({ content: `❌ Le rôle ${role} est au-dessus (ou égal à) mon rôle le plus haut. Déplace mon rôle plus haut.`, ephemeral: true });
    }
    if (cible === 'role' && !filterRole) {
      return interaction.reply({ content: '❌ Choisis le rôle **role_filtre** que les membres doivent déjà avoir.', ephemeral: true });
    }

    const cibleLabel = CIBLES.find((c) => c.value === cible)?.name ?? cible;
    const verbe = mode === 'donner' ? 'donner' : 'retirer';
    const cibleTexte = cible === 'role' ? `les membres ayant ${filterRole}` : cibleLabel.toLowerCase();

    const confirm = new ButtonBuilder().setCustomId('massrole_confirm').setLabel(`Oui, ${verbe}`).setStyle(ButtonStyle.Danger).setEmoji('🎭');
    const cancel = new ButtonBuilder().setCustomId('massrole_cancel').setLabel('Annuler').setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder().addComponents(confirm, cancel);

    const prompt = await interaction.reply({
      content: `⚠️ Tu vas **${verbe} le rôle ${role}** à **${cibleTexte}**. Confirmer ?`,
      components: [row],
      ephemeral: true,
      fetchReply: true,
    });

    let choice;
    try {
      choice = await prompt.awaitMessageComponent({ filter: (i) => i.user.id === interaction.user.id, time: 30_000 });
    } catch {
      return interaction.editReply({ content: '⏳ Temps écoulé, opération annulée.', components: [] }).catch(() => {});
    }
    if (choice.customId === 'massrole_cancel') {
      return choice.update({ content: '❌ Opération annulée.', components: [] }).catch(() => {});
    }

    await choice.update({ content: '⏳ Traitement en cours… (ça peut prendre un moment sur les gros serveurs)', components: [] }).catch(() => {});

    const members = await interaction.guild.members.fetch().catch(() => null);
    if (!members) {
      return interaction.editReply({ content: '❌ Impossible de récupérer la liste des membres.', components: [] }).catch(() => {});
    }

    let changed = 0;
    let skipped = 0;
    let failed = 0;
    for (const [, member] of members) {
      if (!matchesTarget(member, cible, filterRole?.id)) continue;
      const has = member.roles.cache.has(role.id);
      if (mode === 'donner' ? has : !has) {
        skipped += 1;
        continue;
      }
      try {
        if (mode === 'donner') await member.roles.add(role.id, `massrole par ${interaction.user.tag}`);
        else await member.roles.remove(role.id, `massrole par ${interaction.user.tag}`);
        changed += 1;
      } catch {
        failed += 1;
      }
    }

    const action = mode === 'donner' ? 'reçu' : 'perdu';
    return interaction
      .editReply({
        content:
          `✅ **${changed}** membre(s) ont ${action} le rôle ${role}.\n` +
          `↪️ ${skipped} ignoré(s) (déjà à jour)` +
          (failed ? `\n⚠️ ${failed} échec(s) — souvent des membres avec un rôle au-dessus du mien.` : ''),
        components: [],
      })
      .catch(() => {});
  },
};
