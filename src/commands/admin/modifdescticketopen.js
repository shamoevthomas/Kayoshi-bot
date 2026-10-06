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
import { ticketWelcome, refreshOpenTicketsWelcome } from '../../lib/tickets.js';

const slotKey = (slot) => (slot === 2 ? 'ticketConfig2' : 'ticketConfig');
const cfgCmd = (slot) => (slot === 2 ? 'configticket2' : 'configticket');
const MAX_LEN = 1000;

// Change le texte d'accueil affiché à l'ouverture d'un ticket (embed « Ticket #N »)
// pour un seul motif, sans relancer /configticket. Les tickets déjà ouverts de ce
// motif sont mis à jour aussi.
export default {
  data: new SlashCommandBuilder()
    .setName('modifdescticketopen')
    .setDescription('Changer le texte affiché à l’ouverture d’un ticket, pour un motif.')
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

    const select = new StringSelectMenuBuilder().setCustomId('mdto_pick').setPlaceholder('Choisis le motif à modifier');
    for (const m of config.motifs) {
      const opt = new StringSelectMenuOptionBuilder()
        .setLabel(m.label)
        .setValue(m.id)
        .setDescription(ticketWelcome(config, m).replace(/\s+/g, ' ').slice(0, 100));
      if (m.emoji) opt.setEmoji(m.emoji);
      select.addOptions(opt);
    }

    const msg = await interaction.reply({
      content: 'Pour quel motif veux-tu changer le texte d’ouverture du ticket ?',
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
      .setCustomId('welcome')
      .setLabel('Nouveau texte à l’ouverture du ticket')
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(MAX_LEN)
      .setValue(ticketWelcome(config, motif).slice(0, MAX_LEN));

    const modal = new ModalBuilder()
      .setCustomId('mdto_modal')
      .setTitle(`Ouverture — ${motif.label}`.slice(0, 45))
      .addComponents(new ActionRowBuilder().addComponents(input));
    await sel.showModal(modal);

    let sub;
    try {
      sub = await sel.awaitModalSubmit({ time: 600_000, filter: (i) => i.customId === 'mdto_modal' && i.user.id === interaction.user.id });
    } catch {
      return interaction.editReply({ content: '⏱️ Délai dépassé.', components: [] }).catch(() => {});
    }

    const welcome = sub.fields.getTextInputValue('welcome').trim();
    if (!welcome) return sub.reply({ content: '❌ Le texte ne peut pas être vide.', ephemeral: true });

    // Texte commun à tous les motifs → passe en texte par motif : les autres
    // gardent le texte commun (repli), seul celui-ci change.
    if (config.welcomeMode !== 'per') {
      config.welcomeMode = 'per';
      for (const m of config.motifs) m.welcome = null;
    }
    motif.welcome = welcome;
    setTicketConfig(interaction.guild.id, config, key);

    await sub.deferReply({ ephemeral: true });
    const updated = await refreshOpenTicketsWelcome(interaction.guild, config, motif);

    await interaction.editReply({ content: '✅ Terminé.', components: [] }).catch(() => {});
    return sub.editReply({
      content:
        `✅ Texte d’ouverture de **${motif.label}** mis à jour pour les prochains tickets.` +
        (updated ? `\n🔄 **${updated}** ticket(s) déjà ouvert(s) mis à jour aussi.` : ''),
    });
  },
};
