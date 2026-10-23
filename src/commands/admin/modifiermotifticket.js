import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
} from 'discord.js';
import { getTicketConfig, setTicketConfig } from '../../lib/store.js';
import { refreshTicketPanel, syncMotifCategoryName } from '../../lib/tickets.js';

const slotKey = (slot) => (slot === 2 ? 'ticketConfig2' : 'ticketConfig');
const cfgCmd = (slot) => (slot === 2 ? 'configticket2' : 'configticket');

// Change le titre (nom) et/ou la description (affichée sous le nom dans le menu
// déroulant) d'un motif existant : met à jour le panneau publié ET renomme la
// catégorie Discord associée si le titre change.
export default {
  data: new SlashCommandBuilder()
    .setName('modifiermotifticket')
    .setDescription('Changer le titre et/ou la description d’un motif de ticket existant.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const slot = interaction.options.getInteger('systeme') ?? 1;
    const key = slotKey(slot);
    const config = getTicketConfig(interaction.guild.id, key);
    if (!config?.motifs?.length) {
      return interaction.reply({
        content: `❌ Aucun motif configuré pour le système ${slot}. Lance d'abord \`/${cfgCmd(slot)}\`.`,
        ephemeral: true,
      });
    }

    const select = new StringSelectMenuBuilder().setCustomId('mmt_pick').setPlaceholder('Choisis le motif à modifier');
    for (const m of config.motifs) {
      const opt = new StringSelectMenuOptionBuilder().setLabel(m.label).setValue(m.id);
      if (m.description) opt.setDescription(m.description.slice(0, 100));
      if (m.emoji) opt.setEmoji(m.emoji);
      select.addOptions(opt);
    }

    const msg = await interaction.reply({
      content: 'Quel motif veux-tu modifier ?',
      components: [new ActionRowBuilder().addComponents(select)],
      ephemeral: true,
      fetchReply: true,
    });

    const filter = (i) => i.user.id === interaction.user.id;
    let sel;
    try {
      sel = await msg.awaitMessageComponent({ componentType: ComponentType.StringSelect, time: 300_000, filter });
    } catch {
      return interaction.editReply({ content: '⏱️ Délai dépassé.', components: [] }).catch(() => {});
    }

    const motif = config.motifs.find((m) => m.id === sel.values[0]);
    if (!motif) return sel.update({ content: '❌ Motif introuvable.', components: [] }).catch(() => {});
    const oldLabel = motif.label;
    const oldDesc = motif.description ?? null;

    const labelInput = new TextInputBuilder()
      .setCustomId('label')
      .setLabel('Titre du motif')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(80)
      .setValue(motif.label);

    const descInput = new TextInputBuilder()
      .setCustomId('desc')
      .setLabel('Description (menu déroulant)')
      .setPlaceholder('Laisse vide pour retirer la description')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(90);
    if (motif.description) descInput.setValue(motif.description);

    const modal = new ModalBuilder()
      .setCustomId('mmt_modal')
      .setTitle(`Motif — ${motif.label}`.slice(0, 45))
      .addComponents(
        new ActionRowBuilder().addComponents(labelInput),
        new ActionRowBuilder().addComponents(descInput),
      );
    await sel.showModal(modal);

    let sub;
    try {
      sub = await sel.awaitModalSubmit({ time: 600_000, filter: (i) => i.customId === 'mmt_modal' && i.user.id === interaction.user.id });
    } catch {
      return interaction.editReply({ content: '⏱️ Délai dépassé.', components: [] }).catch(() => {});
    }

    const label = sub.fields.getTextInputValue('label').trim().slice(0, 80);
    if (!label) {
      await interaction.editReply({ content: '✅ Terminé.', components: [] }).catch(() => {});
      return sub.reply({ content: '❌ Le titre ne peut pas être vide.', ephemeral: true });
    }

    const desc = sub.fields.getTextInputValue('desc').trim() || null;
    const labelChanged = label !== oldLabel;
    const descChanged = desc !== oldDesc;

    if (!labelChanged && !descChanged) {
      await interaction.editReply({ content: '✅ Terminé.', components: [] }).catch(() => {});
      return sub.reply({ content: `ℹ️ Aucun changement pour **${oldLabel}**.`, ephemeral: true });
    }

    motif.label = label;
    motif.description = desc;
    setTicketConfig(interaction.guild.id, config, key);
    if (labelChanged) await syncMotifCategoryName(interaction.guild, motif);
    const refreshed = await refreshTicketPanel(interaction.guild, config, slot);

    const changes = [];
    if (labelChanged) changes.push(`• Titre : **${oldLabel}** → **${label}** (catégorie renommée)`);
    if (descChanged) changes.push(`• Description ${desc ? 'mise à jour' : 'supprimée'}`);

    await interaction.editReply({ content: '✅ Terminé.', components: [] }).catch(() => {});
    return sub.reply({
      content:
        `✅ Motif **${label}** modifié :\n${changes.join('\n')}\n` +
        (refreshed
          ? 'Le panneau a été actualisé.'
          : '⚠️ Panneau non retrouvé dans son salon : ouvre « Ouverture de ticket » avec `/modifierembed` et clique sur 💾 pour le republier.'),
      ephemeral: true,
    });
  },
};
