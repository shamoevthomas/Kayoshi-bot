import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { addBonusInvites } from '../../lib/store.js';
import { syncInviteRankRole } from '../../lib/inviterank.js';

export default {
  data: new SlashCommandBuilder()
    .setName('invitebonus')
    .setDescription('Ajouter ou retirer des invitations bonus à un membre.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('ajouter')
        .setDescription('Créditer des invitations bonus à un membre.')
        .addUserOption((opt) => opt.setName('membre').setDescription('Le membre à créditer').setRequired(true))
        .addIntegerOption((opt) =>
          opt.setName('montant').setDescription("Nombre d'invitations à ajouter").setMinValue(1).setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('Retirer des invitations bonus à un membre.')
        .addUserOption((opt) => opt.setName('membre').setDescription('Le membre concerné').setRequired(true))
        .addIntegerOption((opt) =>
          opt.setName('montant').setDescription("Nombre d'invitations à retirer").setMinValue(1).setRequired(true),
        ),
    ),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('membre');
    const montant = interaction.options.getInteger('montant');

    if (target.bot) {
      return interaction.reply({ content: '❌ Les bots ne peuvent pas avoir d’invitations.', ephemeral: true });
    }

    const delta = sub === 'ajouter' ? montant : -montant;
    const { bonus, total } = addBonusInvites(interaction.guild.id, target.id, delta);

    // Le total a changé → on réajuste le rôle de palier du membre.
    await syncInviteRankRole(interaction.guild, target.id, total).catch(() => {});

    const verb = sub === 'ajouter' ? 'ajouté' : 'retiré';
    return interaction.reply({
      content:
        `✅ **${montant}** invitation(s) bonus ${verb} à ${target}.\n` +
        `Bonus actuel : **${bonus}** — total : **${total}** invitation(s).`,
      ephemeral: true,
    });
  },
};
