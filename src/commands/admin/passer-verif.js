import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { forceVerify } from '../../lib/verification.js';

export default {
  data: new SlashCommandBuilder()
    .setName('passer-verif')
    .setDescription("Valider la vérification d'un membre manuellement (comme s'il avait réussi le captcha).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addUserOption((opt) =>
      opt.setName('membre').setDescription('Le membre à faire passer la vérification').setRequired(true),
    ),

  async execute(interaction) {
    const user = interaction.options.getUser('membre');

    // On récupère le membre directement (fetch) : un membre encore en attente de
    // l'écran d'accueil (onboarding, `pending`) n'est pas toujours résolu par
    // getMember() → on le force en le récupérant auprès du serveur.
    let member = interaction.options.getMember('membre');
    if (!member && user) {
      member = await interaction.guild.members.fetch(user.id).catch(() => null);
    }
    if (!member) {
      await interaction.reply({ content: '❌ Ce membre est introuvable sur le serveur.', ephemeral: true });
      return;
    }

    const res = await forceVerify(member, interaction.user).catch(() => ({ ok: false, reason: 'error' }));

    const messages = {
      'no-config': "❌ La vérification n'est pas configurée sur ce serveur (`/configverif`).",
      bot: '❌ Impossible : ce membre est un bot.',
      already: `ℹ️ ${member} est déjà vérifié.`,
      error: '❌ Erreur : impossible d’ajouter le rôle (vérifie mes permissions).',
    };

    if (!res.ok) {
      await interaction.reply({ content: messages[res.reason] ?? messages.error, ephemeral: true });
      return;
    }

    await interaction.reply({ content: `✅ ${member} a été vérifié manuellement.`, ephemeral: true });
  },
};
