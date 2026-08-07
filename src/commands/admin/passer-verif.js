import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { forceVerify } from '../../lib/verification.js';

export default {
  data: new SlashCommandBuilder()
    .setName('passer-verif')
    .setDescription("Valider la vérification d'un membre manuellement (comme s'il avait réussi le captcha).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addUserOption((opt) =>
      opt.setName('membre').setDescription('Le membre à faire passer la vérification').setRequired(false),
    )
    .addStringOption((opt) =>
      opt
        .setName('id')
        .setDescription("ID du membre (à utiliser s'il est bloqué à l'écran d'accueil → « Utilisateur invalide »)")
        .setRequired(false),
    ),

  async execute(interaction) {
    // Discord refuse de résoudre un membre encore en écran d'accueil (pending) via
    // l'option Utilisateur (erreur « Utilisateur invalide »). D'où l'option `id` :
    // le bot, lui, sait récupérer un membre pending par son ID côté serveur.
    const user = interaction.options.getUser('membre');
    const rawId = interaction.options.getString('id')?.trim();
    const targetId = rawId || user?.id;

    if (!targetId) {
      await interaction.reply({
        content: '❌ Précise un **membre** ou un **id**. Astuce : si Discord affiche « Utilisateur invalide » en sélectionnant le membre, colle plutôt son ID dans l’option `id`.',
        ephemeral: true,
      });
      return;
    }

    if (!/^\d{17,20}$/.test(targetId)) {
      await interaction.reply({ content: `❌ ID invalide : \`${targetId}\`. Un ID Discord est une suite de chiffres.`, ephemeral: true });
      return;
    }

    // Fetch direct : fonctionne même pour un membre en attente d'écran d'accueil.
    const member =
      interaction.options.getMember('membre') ||
      (await interaction.guild.members.fetch(targetId).catch(() => null));

    if (!member) {
      await interaction.reply({ content: `❌ Aucun membre \`${targetId}\` trouvé sur le serveur (a-t-il quitté ?).`, ephemeral: true });
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
