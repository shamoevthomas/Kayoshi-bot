import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getSavedMessage, setSavedMessage } from '../../lib/store.js';

const SLOTS = ['1', '2', '3', '4', '5'];

function buildRows(slot, hasSaved) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`save_create:${slot}`)
        .setLabel('Créer une sauvegarde')
        .setStyle(ButtonStyle.Success)
        .setEmoji('💾'),
      new ButtonBuilder()
        .setCustomId(`save_use:${slot}`)
        .setLabel('Utiliser une sauvegarde')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📤')
        .setDisabled(!hasSaved),
    ),
  ];
}

export default {
  data: (() => {
    const b = new SlashCommandBuilder()
      .setName('save')
      .setDescription('Messages sauvegardés (5 emplacements).')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .setDMPermission(false);
    for (const s of SLOTS) {
      b.addSubcommand((sub) => sub.setName(s).setDescription(`Emplacement de sauvegarde n°${s}`));
    }
    return b;
  })(),

  async execute(interaction) {
    const slot = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    const filter = (i) => i.user.id === interaction.user.id;

    const existing = getSavedMessage(guildId, slot);
    const header = existing
      ? `💾 **Sauvegarde n°${slot}** — un message est enregistré.\n> ${existing.content.replaceAll('\n', '\n> ').slice(0, 300)}`
      : `💾 **Sauvegarde n°${slot}** — aucun message enregistré pour l'instant.`;

    const msg = await interaction.reply({
      content: `${header}\n\nQue veux-tu faire ?`,
      components: buildRows(slot, Boolean(existing)),
      ephemeral: true,
      fetchReply: true,
    });

    let btn;
    try {
      btn = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 120_000, filter });
    } catch {
      return interaction.editReply({ content: '⏱️ Temps écoulé. Relance la commande.', components: [] }).catch(() => {});
    }

    // ===== Utiliser une sauvegarde =====
    if (btn.customId.startsWith('save_use:')) {
      const saved = getSavedMessage(guildId, slot);
      if (!saved) {
        return btn.update({ content: `❌ Aucun message enregistré dans la sauvegarde n°${slot}.`, components: [] });
      }
      await interaction.channel.send({ content: saved.content }).catch(() => {});
      return btn.update({ content: `✅ Message de la sauvegarde n°${slot} envoyé.`, components: [] });
    }

    // ===== Créer une sauvegarde (modal) =====
    const modal = new ModalBuilder()
      .setCustomId(`save_modal:${slot}`)
      .setTitle(`Sauvegarde n°${slot}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('content')
            .setLabel('Message à enregistrer')
            .setPlaceholder('Écris ici le message à sauvegarder…')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(2000)
            .setValue(existing?.content ?? ''),
        ),
      );
    await btn.showModal(modal);

    let sub;
    try {
      sub = await btn.awaitModalSubmit({
        time: 600_000,
        filter: (i) => i.customId === `save_modal:${slot}` && i.user.id === interaction.user.id,
      });
    } catch {
      return interaction.editReply({ content: '⏱️ Temps écoulé. Relance la commande.', components: [] }).catch(() => {});
    }

    const content = sub.fields.getTextInputValue('content').trim();
    if (!content) {
      return sub.reply({ content: '❌ Message vide, rien n’a été enregistré.', ephemeral: true });
    }
    setSavedMessage(guildId, slot, { content, authorId: interaction.user.id, ts: Date.now() });
    return sub.reply({
      content: `✅ Message enregistré dans la sauvegarde n°${slot} !\nUtilise \`/save ${slot}\` puis **Utiliser une sauvegarde** pour l’envoyer.`,
      ephemeral: true,
    });
  },
};
