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
import { refreshTicketPanel } from '../../lib/tickets.js';

const slotKey = (slot) => (slot === 2 ? 'ticketConfig2' : 'ticketConfig');
const cfgCmd = (slot) => (slot === 2 ? 'configticket2' : 'configticket');

// Change la description (celle affichée sous le nom dans le menu déroulant du
// panneau) d'un motif existant, puis ré-édite le panneau publié.
export default {
  data: new SlashCommandBuilder()
    .setName('modifierdescriptionticket')
    .setDescription('Changer la description (menu déroulant) d’un motif de ticket existant.')
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

    const select = new StringSelectMenuBuilder().setCustomId('mdt_pick').setPlaceholder('Choisis le motif à modifier');
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

    const input = new TextInputBuilder()
      .setCustomId('desc')
      .setLabel('Nouvelle description (menu déroulant)')
      .setPlaceholder('Laisse vide pour retirer la description')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(90);
    if (motif.description) input.setValue(motif.description);

    const modal = new ModalBuilder()
      .setCustomId('mdt_modal')
      .setTitle(`Description — ${motif.label}`.slice(0, 45))
      .addComponents(new ActionRowBuilder().addComponents(input));
    await sel.showModal(modal);

    let sub;
    try {
      sub = await sel.awaitModalSubmit({ time: 600_000, filter: (i) => i.customId === 'mdt_modal' && i.user.id === interaction.user.id });
    } catch {
      return interaction.editReply({ content: '⏱️ Délai dépassé.', components: [] }).catch(() => {});
    }

    const desc = sub.fields.getTextInputValue('desc').trim();
    motif.description = desc || null;
    setTicketConfig(interaction.guild.id, config, key);
    const refreshed = await refreshTicketPanel(interaction.guild, config, slot);

    await interaction.editReply({ content: '✅ Terminé.', components: [] }).catch(() => {});
    return sub.reply({
      content:
        `✅ Description de **${motif.label}** ${desc ? 'mise à jour.' : 'supprimée.'}` +
        (refreshed ? ' Le panneau a été actualisé.' : ` ⚠️ Panneau non retrouvé — republie-le via \`/${cfgCmd(slot)}\` si besoin.`),
      ephemeral: true,
    });
  },
};
