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
    // On diffère tout de suite : fetch du membre + ajout de rôle + log peuvent
    // dépasser les 3 s de la fenêtre de réponse d'une interaction.
    await interaction.deferReply({ ephemeral: true });

    try {
      // Discord refuse de résoudre un membre encore en écran d'accueil (pending)
      // via l'option Utilisateur (« Utilisateur invalide »). D'où l'option `id` :
      // le bot sait récupérer un membre pending par son ID côté serveur.
      const user = interaction.options.getUser('membre');
      const rawId = interaction.options.getString('id')?.trim();
      const targetId = rawId || user?.id;

      if (!targetId) {
        return interaction.editReply({
          content: '❌ Précise un **membre** ou un **id**. Astuce : si Discord affiche « Utilisateur invalide » en sélectionnant le membre, colle plutôt son ID dans l’option `id`.',
        });
      }

      if (!/^\d{17,20}$/.test(targetId)) {
        return interaction.editReply({ content: `❌ ID invalide : \`${targetId}\`. Un ID Discord est une suite de chiffres.` });
      }

      // Fetch direct : fonctionne même pour un membre en attente d'écran d'accueil.
      const member =
        interaction.options.getMember('membre') ||
        (await interaction.guild.members.fetch(targetId).catch(() => null));

      if (!member) {
        return interaction.editReply({ content: `❌ Aucun membre \`${targetId}\` trouvé sur le serveur (a-t-il quitté ?).` });
      }

      // On laisse remonter les vraies erreurs Discord (permissions, rôle, etc.)
      // pour les afficher à l'admin au lieu d'un message générique.
      const res = await forceVerify(member, interaction.user);

      const messages = {
        'no-config': "❌ La vérification n'est pas configurée sur ce serveur (`/configverif`).",
        bot: '❌ Impossible : ce membre est un bot.',
        already: `ℹ️ ${member} est déjà vérifié.`,
      };

      if (!res.ok) {
        return interaction.editReply({ content: messages[res.reason] ?? '❌ Impossible de valider ce membre.' });
      }

      return interaction.editReply({ content: `✅ ${member} a été vérifié manuellement.` });
    } catch (err) {
      console.error('[passer-verif] échec :', err);
      const reason = err?.message || String(err);
      return interaction
        .editReply({ content: `❌ Erreur : ${reason}\n(Vérifie que mon rôle est **au-dessus** du rôle de vérif et que j'ai la permission **Gérer les rôles**.)` })
        .catch(() => {});
    }
  },
};
