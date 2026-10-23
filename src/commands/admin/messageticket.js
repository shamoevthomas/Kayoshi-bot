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

const slotKey = (slot) => (slot === 2 ? 'ticketConfig2' : 'ticketConfig');
const cfgCmd = (slot) => (slot === 2 ? 'configticket2' : 'configticket');
const MAX_LEN = 1900; // marge pour les [@] remplacés par une mention (limite Discord : 2000)

// Définit, pour un motif, le premier message envoyé dans chaque nouveau ticket
// (juste après l'embed d'accueil). [@] mentionne celui qui a ouvert le ticket.
export default {
  data: new SlashCommandBuilder()
    .setName('messageticket')
    .setDescription('Définir le premier message envoyé dans un ticket, pour un motif ([@] = mention de l’auteur).')
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

    const select = new StringSelectMenuBuilder().setCustomId('mtk_pick').setPlaceholder('Choisis le motif');
    for (const m of config.motifs) {
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(m.label)
        .setValue(m.id)
        .setDescription(m.firstMessage ? m.firstMessage.replace(/\s+/g, ' ').slice(0, 100) : 'Aucun premier message');
      if (m.emoji) opt.setEmoji(m.emoji);
      select.addOptions(opt);
    }

    const msg = await interaction.reply({
      content: 'Pour quel motif veux-tu définir le premier message du ticket ?',
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
      .setCustomId('text')
      .setLabel('Premier message ([@] = auteur du ticket)')
      .setPlaceholder('Ex : Salut [@] ! Explique-nous ta demande en détail. Laisse vide pour retirer.')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(false)
      .setMaxLength(MAX_LEN);
    if (motif.firstMessage) input.setValue(motif.firstMessage);

    const modal = new ModalBuilder()
      .setCustomId('mtk_modal')
      .setTitle(`Premier message — ${motif.label}`.slice(0, 45))
      .addComponents(new ActionRowBuilder().addComponents(input));
    await sel.showModal(modal);

    let sub;
    try {
      sub = await sel.awaitModalSubmit({ time: 600_000, filter: (i) => i.customId === 'mtk_modal' && i.user.id === interaction.user.id });
    } catch {
      return interaction.editReply({ content: '⏱️ Délai dépassé.', components: [] }).catch(() => {});
    }

    const text = sub.fields.getTextInputValue('text').trim();
    motif.firstMessage = text || null;
    setTicketConfig(interaction.guild.id, config, key);

    await interaction.editReply({ content: '✅ Terminé.', components: [] }).catch(() => {});
    return sub.reply({
      content: text
        ? `✅ Premier message de **${motif.label}** enregistré. Il sera envoyé dans chaque nouveau ticket de ce motif` +
          (text.includes('[@]') ? ', avec la mention de celui qui l’a ouvert.' : '.')
        : `✅ Premier message de **${motif.label}** supprimé.`,
      ephemeral: true,
    });
  },
};
