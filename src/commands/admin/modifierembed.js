import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { openEmbedEditor, embedEditorChoices } from '../../lib/embedbuilder.js';

// Rouvre un embed existant dans le créateur d'embed (/embed) : embeds envoyés avec
// /embed, embed partenariat, bienvenue / départ, ou panneau de tickets avec son sélecteur.
export default {
  data: new SlashCommandBuilder()
    .setName('modifierembed')
    .setDescription('Modifier un embed existant : règlement, partenariat, bienvenue / départ, panneau de tickets…')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addStringOption((o) =>
      o
        .setName('embed')
        .setDescription('L’embed à modifier (ou colle le lien du message)')
        .setRequired(true)
        .setAutocomplete(true),
    ),

  async execute(interaction) {
    await openEmbedEditor(interaction, interaction.options.getString('embed', true));
  },

  async autocomplete(interaction) {
    await interaction.respond(embedEditorChoices(interaction));
  },
};
