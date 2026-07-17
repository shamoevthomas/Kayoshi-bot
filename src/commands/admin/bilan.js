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
  EmbedBuilder,
} from 'discord.js';
import { getGuildConfig } from '../../lib/store.js';
import { Colors } from '../../lib/logger.js';

const DAY = 86_400_000;

// Périodes prédéfinies (avec explication affichée dans le menu = l'accompagnement).
const PRESETS = [
  { value: '1d', label: 'Dernières 24 heures', desc: "Depuis hier à la même heure jusqu'à maintenant", ms: DAY, emoji: '🕐' },
  { value: '7d', label: '7 derniers jours', desc: 'La dernière semaine glissante', ms: 7 * DAY, emoji: '📅' },
  { value: '30d', label: '30 derniers jours', desc: 'Le dernier mois glissant', ms: 30 * DAY, emoji: '🗓️' },
  { value: '90d', label: '90 derniers jours', desc: 'Le dernier trimestre glissant', ms: 90 * DAY, emoji: '📆' },
  { value: 'all', label: 'Depuis le début du suivi', desc: 'Tout ce que le bot a enregistré', ms: null, emoji: '♾️' },
  { value: 'custom', label: 'Période personnalisée…', desc: 'Choisir deux dates précises (du … au …)', ms: 0, emoji: '✏️' },
];

// Parse une date au format JJ/MM/AAAA. endOfDay=true → fin de journée (23:59:59).
function parseDate(str, endOfDay) {
  const m = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, d, mo, y] = m.map(Number);
  const date = new Date(y, mo - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  // Rejette les dates impossibles (ex: 32/13/2026)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date.getTime();
}

// Construit l'embed du bilan pour l'intervalle [from, to].
async function buildBilan(interaction, from, to, periodLabel) {
  const cfg = getGuildConfig(interaction.guild.id);
  const trackingSince = cfg.trackingSince ?? Date.now();
  const events = cfg.memberEvents ?? [];

  const members = await interaction.guild.members.fetch();
  const joins = members.filter(
    (m) => !m.user.bot && m.joinedTimestamp && m.joinedTimestamp >= from && m.joinedTimestamp <= to,
  ).size;
  const leaves = events.filter((e) => e.t === 'leave' && e.ts >= from && e.ts <= to).length;

  const net = joins - leaves;
  const netStr = net > 0 ? `+${net}` : `${net}`;
  const leavesReliable = from >= trackingSince;

  const embed = new EmbedBuilder()
    .setColor(net >= 0 ? Colors.join : Colors.leave)
    .setTitle(`📊 Bilan — ${periodLabel}`)
    .addFields(
      { name: '📥 Arrivées', value: `**${joins}**`, inline: true },
      { name: '📤 Départs', value: `**${leaves}**`, inline: true },
      { name: '📈 Solde net', value: `**${netStr}**`, inline: true },
      {
        name: 'Intervalle analysé',
        value: `Du <t:${Math.floor(from / 1000)}:D> au <t:${Math.floor(to / 1000)}:D>`,
      },
    )
    .setFooter({
      text: leavesReliable
        ? 'Période entièrement couverte par le suivi.'
        : 'Départs partiels : voir l’avertissement ci-dessus.',
    })
    .setTimestamp();

  if (!leavesReliable) {
    embed.setDescription(
      `⚠️ Les **départs** ne sont suivis que depuis <t:${Math.floor(trackingSince / 1000)}:D>.\n` +
        `Avant cette date, Discord ne fournit aucune donnée : le nombre de départs (et donc le solde) est **sous-estimé** sur cette période.\n` +
        `Les **arrivées** restent fiables (date d'arrivée des membres encore présents).`,
    );
  }
  return embed;
}

export default {
  data: new SlashCommandBuilder()
    .setName('bilan')
    .setDescription('Bilan des arrivées et départs sur une période.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const menu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('bilan_period')
        .setPlaceholder('📊 Choisis une période')
        .addOptions(
          PRESETS.map((p) =>
            new StringSelectMenuOptionBuilder()
              .setLabel(p.label)
              .setDescription(p.desc)
              .setValue(p.value)
              .setEmoji(p.emoji),
          ),
        ),
    );

    const guide = new EmbedBuilder()
      .setColor(Colors.role)
      .setTitle('📊 Bilan des membres — mode d’emploi')
      .setDescription(
        'Choisis une période dans le menu ci-dessous :\n\n' +
          '🕐 **Périodes glissantes** (24h, 7j, 30j, 90j) → comptées à rebours depuis maintenant.\n' +
          '♾️ **Depuis le début du suivi** → tout l’historique enregistré par le bot.\n' +
          '✏️ **Période personnalisée** → tu saisis deux dates précises au format `JJ/MM/AAAA` (ex : `01/07/2026` → `17/07/2026`).\n\n' +
          '_Rappel : les arrivées sont fiables sur toute la durée ; les départs ne sont exacts que depuis le lancement du suivi._',
      );

    const msg = await interaction.reply({
      embeds: [guide],
      components: [menu],
      ephemeral: true,
      fetchReply: true,
    });

    let selection;
    try {
      selection = await msg.awaitMessageComponent({
        componentType: ComponentType.StringSelect,
        time: 120_000,
        filter: (i) => i.user.id === interaction.user.id,
      });
    } catch {
      return interaction.editReply({ content: '⏱️ Temps écoulé, réessaie avec `/bilan`.', embeds: [], components: [] });
    }

    const chosen = PRESETS.find((p) => p.value === selection.values[0]);

    // --- Période personnalisée : ouvre un formulaire avec template de dates ---
    if (chosen.value === 'custom') {
      const modal = new ModalBuilder()
        .setCustomId('bilan_modal')
        .setTitle('Période personnalisée')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('start')
              .setLabel('Date de début (JJ/MM/AAAA)')
              .setPlaceholder('ex : 01/07/2026')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMinLength(8)
              .setMaxLength(10),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('end')
              .setLabel('Date de fin (JJ/MM/AAAA)')
              .setPlaceholder('ex : 17/07/2026')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMinLength(8)
              .setMaxLength(10),
          ),
        );

      await selection.showModal(modal);

      let submit;
      try {
        submit = await selection.awaitModalSubmit({
          time: 120_000,
          filter: (i) => i.customId === 'bilan_modal' && i.user.id === interaction.user.id,
        });
      } catch {
        return interaction.editReply({ content: '⏱️ Formulaire non validé à temps.', embeds: [], components: [] });
      }

      const from = parseDate(submit.fields.getTextInputValue('start'), false);
      const to = parseDate(submit.fields.getTextInputValue('end'), true);

      if (from === null || to === null) {
        return submit.update({
          content: '❌ Format de date invalide. Utilise **JJ/MM/AAAA**, ex : `01/07/2026`.',
          embeds: [],
          components: [],
        });
      }
      if (from > to) {
        return submit.update({
          content: '❌ La date de début doit être **avant** la date de fin.',
          embeds: [],
          components: [],
        });
      }

      const label = `personnalisée`;
      const embed = await buildBilan(interaction, from, to, label);
      return submit.update({ content: '', embeds: [embed], components: [] });
    }

    // --- Période prédéfinie ---
    await selection.update({ content: '⏳ Calcul en cours…', embeds: [], components: [] });
    const now = Date.now();
    const from = chosen.ms ? now - chosen.ms : 0;
    const embed = await buildBilan(interaction, from, now, chosen.label);
    return interaction.editReply({ content: '', embeds: [embed], components: [] });
  },
};
