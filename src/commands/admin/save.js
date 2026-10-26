import { SlashCommandBuilder, PermissionFlagsBits, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getSavedMessage, setSavedMessage } from '../../lib/store.js';

// /save emplacement:save1…save5 action:enregistrer|envoyer — 5 messages sauvegardés par serveur.
// L'emplacement se choisit dans une liste qui montre un aperçu de ce qui y est déjà enregistré.
const SLOTS = ['1', '2', '3', '4', '5'];

const preview = (text) => {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > 70 ? `${oneLine.slice(0, 69)}…` : oneLine;
};

export default {
  data: new SlashCommandBuilder()
    .setName('save')
    .setDescription('Enregistrer un message dans un emplacement (save1 à save5), ou envoyer un message enregistré.')
    .addStringOption((o) => o.setName('emplacement').setDescription('save1 à save5').setRequired(true).setAutocomplete(true))
    .addStringOption((o) =>
      o
        .setName('action')
        .setDescription('Enregistrer un nouveau message, ou envoyer celui qui est enregistré')
        .setRequired(true)
        .addChoices({ name: 'Enregistrer un message', value: 'enregistrer' }, { name: 'Envoyer le message enregistré', value: 'envoyer' }),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false),

  // Liste des 5 emplacements avec un aperçu de leur contenu.
  async autocomplete(interaction) {
    const guildId = interaction.guild.id;
    await interaction.respond(
      SLOTS.map((slot) => {
        const saved = getSavedMessage(guildId, slot);
        return { name: `save${slot} — ${saved ? preview(saved.content) : '(vide)'}`, value: slot };
      }),
    );
  },

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const slot = interaction.options.getString('emplacement').replace(/^save\s*/i, '');
    if (!SLOTS.includes(slot)) {
      return interaction.reply({ content: '❌ Choisis un emplacement dans la liste (save1 à save5).', ephemeral: true });
    }
    const existing = getSavedMessage(guildId, slot);

    if (interaction.options.getString('action') === 'envoyer') {
      if (!existing) return interaction.reply({ content: `❌ Rien n’est enregistré dans save${slot}.`, ephemeral: true });
      await interaction.channel.send({ content: existing.content }).catch(() => {});
      return interaction.reply({ content: `✅ Message de save${slot} envoyé.`, ephemeral: true });
    }

    // Enregistrer : formulaire pré-rempli avec le message actuel de l'emplacement.
    const modalId = `save_modal:${slot}:${interaction.id}`;
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(modalId)
        .setTitle(`Sauvegarde save${slot}`)
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('Message à enregistrer')
            .setDescription(existing ? 'Remplace le message déjà enregistré' : 'Emplacement vide pour l’instant')
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId('content')
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMaxLength(2000)
                .setPlaceholder('Écris ici le message à sauvegarder…')
                .setValue(existing?.content ?? ''),
            ),
        ),
    );

    let submit;
    try {
      submit = await interaction.awaitModalSubmit({ time: 600_000, filter: (i) => i.customId === modalId && i.user.id === interaction.user.id });
    } catch {
      return; // formulaire fermé ou temps écoulé : rien n'est enregistré
    }
    const content = submit.fields.getTextInputValue('content').trim();
    if (!content) return submit.reply({ content: '❌ Message vide, rien n’a été enregistré.', ephemeral: true });
    setSavedMessage(guildId, slot, { content, authorId: interaction.user.id, ts: Date.now() });
    return submit.reply({
      content: `✅ Message enregistré dans save${slot}. Envoie-le avec \`/save emplacement:save${slot} action:Envoyer le message enregistré\`.`,
      ephemeral: true,
    });
  },
};
