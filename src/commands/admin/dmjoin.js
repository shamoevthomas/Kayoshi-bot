import { SlashCommandBuilder, PermissionFlagsBits, ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getDmJoin, setDmJoin } from '../../lib/store.js';
import { TEMPLATE_HELP, renderTextFor } from '../../lib/greetings.js';

const MAX_LENGTH = 1800; // marge pour les templates (un MP fait 2000 caractères max)

const quote = (text) => text.split('\n').map((line) => `> ${line}`).join('\n');

// Message privé envoyé à chaque membre qui rejoint le serveur. Écrit dans un
// formulaire (pré-rempli avec le message actuel) ; vide = désactivé.
export default {
  data: new SlashCommandBuilder()
    .setName('dmjoin')
    .setDescription('Écrire le message privé envoyé à chaque membre qui rejoint le serveur.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const current = getDmJoin(guildId)?.message ?? '';

    const input = new TextInputBuilder()
      .setCustomId('message')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(MAX_LENGTH)
      .setPlaceholder('Bienvenue [user] sur [server] ! Pense à lire le règlement.');
    if (current) input.setValue(current);

    const modalId = `dmjoin_modal:${interaction.id}`;
    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(modalId)
        .setTitle('Message privé à l’arrivée')
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('Message envoyé en MP aux nouveaux membres')
            .setDescription('Vide = désactiver · [user] [@] [server] [count] [date]')
            .setTextInputComponent(input),
        ),
    );

    const sub = await interaction
      .awaitModalSubmit({ time: 900_000, filter: (i) => i.customId === modalId && i.user.id === interaction.user.id })
      .catch(() => null);
    if (!sub) return;

    const message = sub.fields.getTextInputValue('message').trim();
    if (!message) {
      setDmJoin(guildId, null);
      return sub.reply({ content: '🔕 Message privé à l’arrivée **désactivé**.', ephemeral: true });
    }

    setDmJoin(guildId, { message });
    const preview = await renderTextFor(interaction.guild, interaction.user, message);
    return sub.reply({
      content:
        `✅ ${current ? 'Message privé à l’arrivée modifié' : 'Message privé à l’arrivée activé'} : chaque nouveau membre le recevra en MP.\n` +
        `**Aperçu** (comme si tu venais d’arriver) :\n${quote(preview.slice(0, 1200))}\n\n` +
        `-# ${TEMPLATE_HELP}\n` +
        '-# Les membres qui ont fermé leurs MP ne le reçoivent pas. Relance `/dmjoin` et vide le message pour le désactiver.',
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  },
};
