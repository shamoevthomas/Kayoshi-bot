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

// Change le titre (nom) d'un motif existant : met à jour le menu déroulant du
// panneau ET renomme la catégorie Discord associée.
export default {
  data: new SlashCommandBuilder()
    .setName('modifiermotifticket')
    .setDescription('Changer le titre (nom) d’un motif de ticket existant.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addIntegerOption((o) =>
      o
        .setName('systeme')
        .setDescription('Système de tickets concerné (1 par défaut)')
        .addChoices({ name: 'Système 1', value: 1 }, { name: 'Système 2', value: 2 }),
    ),

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

    const select = new StringSelectMenuBuilder().setCustomId('mmt_pick').setPlaceholder('Choisis le motif à renommer');
    for (const m of config.motifs) {
      const opt = new StringSelectMenuOptionBuilder().setLabel(m.label).setValue(m.id);
      if (m.description) opt.setDescription(m.description.slice(0, 100));
      if (m.emoji) opt.setEmoji(m.emoji);
      select.addOptions(opt);
    }

    const msg = await interaction.reply({
      content: 'Quel motif veux-tu renommer ?',
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

    const input = new TextInputBuilder()
      .setCustomId('label')
      .setLabel('Nouveau titre du motif')
      .setStyle(TextInputStyle.Short)
      .setRequired(true)
      .setMaxLength(80)
      .setValue(motif.label);

    const modal = new ModalBuilder()
      .setCustomId('mmt_modal')
      .setTitle(`Titre — ${motif.label}`.slice(0, 45))
      .addComponents(new ActionRowBuilder().addComponents(input));
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

    motif.label = label;
    setTicketConfig(interaction.guild.id, config, key);
    await syncMotifCategoryName(interaction.guild, motif);
    const refreshed = await refreshTicketPanel(interaction.guild, config, slot);

    await interaction.editReply({ content: '✅ Terminé.', components: [] }).catch(() => {});
    return sub.reply({
      content:
        `✅ Motif renommé : **${oldLabel}** → **${label}**. La catégorie a été renommée.` +
        (refreshed ? ' Le panneau a été actualisé.' : ` ⚠️ Panneau non retrouvé — republie-le via \`/${cfgCmd(slot)}\` si besoin.`),
      ephemeral: true,
    });
  },
};
