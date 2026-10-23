import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
} from 'discord.js';
import { getTicketConfig, setTicketConfig } from '../../lib/store.js';
import { ticketTitle, ticketWelcome, ticketStyle, refreshOpenTicketsWelcome } from '../../lib/tickets.js';

const slotKey = (slot) => (slot === 2 ? 'ticketConfig2' : 'ticketConfig');
const cfgCmd = (slot) => (slot === 2 ? 'configticket2' : 'configticket');
const RESET = 'aucun';
const MAX_WELCOME = 1000;

function parseHex(input) {
  let h = (input || '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
  return /^[0-9a-fA-F]{6}$/.test(h) ? parseInt(h, 16) : null;
}

// Lien d'image valide pour un embed. Une page Tenor (tenor.com/view/…) ne s'affiche
// pas : il faut le lien direct du GIF (media.tenor.com/…/….gif).
function imageProblem(url) {
  if (!/^https?:\/\/\S+$/i.test(url)) return `❌ \`${url}\` n’est pas un lien valide.`;
  if (/tenor\.com\/view\//i.test(url)) {
    return '❌ Ce lien est une page Tenor, pas le GIF lui-même. Ouvre le GIF, fais clic droit → **Copier l’adresse de l’image**, et colle ce lien (il finit par `.gif`).';
  }
  return null;
}

// Aperçu de l'embed d'ouverture pour un motif.
function preview(config, motif, user) {
  const style = ticketStyle(config, motif);
  const embed = new EmbedBuilder()
    .setColor(style.color ?? 0x5865f2)
    .setTitle(ticketTitle(style.title, 1, motif.label))
    .setDescription(ticketWelcome(config, motif))
    .addFields({ name: 'Ouvert par', value: `${user}`, inline: true })
    .setTimestamp();
  if (style.image) embed.setImage(style.image);
  if (style.thumbnail) embed.setThumbnail(style.thumbnail);
  return embed;
}

function motifSelect(config) {
  const select = new StringSelectMenuBuilder().setCustomId('met_text').setPlaceholder('✏️ Modifier le texte d’ouverture d’un motif');
  for (const m of config.motifs) {
    const opt = new StringSelectMenuOptionBuilder()
      .setLabel(m.label)
      .setValue(m.id)
      .setDescription(ticketWelcome(config, m).replace(/\s+/g, ' ').slice(0, 100) || 'Aucun texte');
    if (m.emoji) opt.setEmoji(m.emoji);
    select.addOptions(opt);
  }
  return new ActionRowBuilder().addComponents(select);
}

function view(config, motif, user, content) {
  return { content, embeds: [preview(config, motif, user)], components: [motifSelect(config)] };
}

// Motif choisi dans l'autocomplétion ("<système>:<id>"), ou tapé à la main (nom du motif).
function findMotif(config, value) {
  const picked = value.match(/^[12]:(.+)$/);
  if (picked) return config.motifs.find((m) => m.id === picked[1]) ?? null;
  return config.motifs.find((m) => m.label.toLowerCase() === value.trim().toLowerCase()) ?? null;
}

// Change l'embed envoyé à l'ouverture d'un ticket, pour un système :
// - l'apparence (GIF, miniature, couleur, titre) via les options : pour tous les motifs,
//   ou pour un seul avec l'option motif (elle l'emporte alors sur l'apparence commune) ;
// - le texte, propre à chaque motif, via le menu sous l'aperçu (les tickets déjà ouverts
//   de ce motif sont mis à jour aussi).
export default {
  data: new SlashCommandBuilder()
    .setName('modifierembedticket')
    .setDescription('Changer l’embed d’ouverture d’un ticket : GIF, miniature, couleur, titre et texte de chaque motif.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addStringOption((o) =>
      o.setName('motif').setDescription('Motif à modifier (vide = l’apparence de tous les motifs)').setAutocomplete(true),
    )
    .addStringOption((o) => o.setName('gif').setDescription(`Lien du GIF / de l’image en grand (« ${RESET} » pour retirer)`))
    .addStringOption((o) =>
      o.setName('miniature').setDescription(`Lien de la petite image en haut à droite (« ${RESET} » pour retirer)`),
    )
    .addStringOption((o) => o.setName('couleur').setDescription(`Couleur en hex, ex : #ff0000 (« ${RESET} » = par défaut)`))
    .addStringOption((o) =>
      o
        .setName('titre')
        .setDescription(`Titre : [numero] = n° du ticket, [motif] = motif (« ${RESET} » = par défaut)`)
        .setMaxLength(256),
    ),

  async autocomplete(interaction) {
    const slot = interaction.options.getInteger('systeme') ?? 1;
    const query = interaction.options.getFocused().toLowerCase();
    const motifs = getTicketConfig(interaction.guild.id, slotKey(slot))?.motifs ?? [];
    await interaction.respond(
      motifs
        .filter((m) => m.label.toLowerCase().includes(query))
        .slice(0, 25)
        .map((m) => ({ name: `${m.label}${m.welcomeEmbed ? ' (apparence perso)' : ''}`.slice(0, 100), value: `${slot}:${m.id}` })),
    );
  },

  async execute(interaction) {
    const motifValue = interaction.options.getString('motif');
    // Un motif choisi dans la liste porte son système.
    const slot = Number(motifValue?.match(/^([12]):/)?.[1] ?? interaction.options.getInteger('systeme') ?? 1);
    const key = slotKey(slot);
    const guildId = interaction.guild.id;
    const config = getTicketConfig(guildId, key);
    if (!config?.motifs?.length) {
      return interaction.reply({
        content: `❌ Aucun motif configuré pour le système ${slot}. Lance d'abord \`/${cfgCmd(slot)}\`.`,
        ephemeral: true,
      });
    }
    const motif = motifValue ? findMotif(config, motifValue) : null;
    if (motifValue && !motif) {
      return interaction.reply({ content: `❌ Motif « ${motifValue} » introuvable dans le système ${slot} : choisis-le dans la liste.`, ephemeral: true });
    }

    // --- Apparence (options) : celle du motif choisi, sinon celle de tous les motifs ---
    // Pour un motif, « aucun » retire le champ pour ce motif seulement (null l'emporte sur l'apparence commune).
    const style = { ...((motif ? motif.welcomeEmbed : config.welcomeEmbed) ?? {}) };
    const clear = (field) => {
      if (motif) style[field] = null;
      else delete style[field];
    };
    const read = (name) => interaction.options.getString(name)?.trim() || null;
    const isReset = (v) => v?.toLowerCase() === RESET;

    for (const [option, field] of [
      ['gif', 'image'],
      ['miniature', 'thumbnail'],
    ]) {
      const value = read(option);
      if (!value) continue;
      if (isReset(value)) {
        clear(field);
        continue;
      }
      const problem = imageProblem(value);
      if (problem) return interaction.reply({ content: problem, ephemeral: true });
      style[field] = value;
    }

    const color = read('couleur');
    if (isReset(color)) clear('color');
    else if (color) {
      const hex = parseHex(color);
      if (hex == null) return interaction.reply({ content: `❌ \`${color}\` n’est pas une couleur hex (ex : \`#ff0000\`).`, ephemeral: true });
      style.color = hex;
    }

    const title = read('titre');
    if (isReset(title)) clear('title');
    else if (title) style.title = title;

    const changed = ['gif', 'miniature', 'couleur', 'titre'].some((name) => read(name));
    if (changed) {
      if (motif) motif.welcomeEmbed = style;
      else config.welcomeEmbed = style;
      setTicketConfig(guildId, config, key);
    }

    // --- Aperçu (motif choisi, sinon le premier) + menu pour changer le texte d'un motif ---
    const own = config.motifs.filter((m) => m.welcomeEmbed).map((m) => `**${m.label}**`);
    let status;
    if (changed && motif) {
      status = `✅ Apparence du motif **${motif.label}** modifiée (système ${slot}) : elle s’appliquera à ses **prochains** tickets. Aperçu :`;
    } else if (changed) {
      status =
        `✅ Apparence de tous les motifs modifiée (système ${slot}) : elle s’appliquera aux **prochains** tickets. Aperçu :` +
        (own.length ? `\n-# ${own.join(', ')} ${own.length > 1 ? 'gardent leur' : 'garde son'} apparence perso pour les champs ${own.length > 1 ? 'qu’ils ont' : 'qu’il a'} changés.` : '');
    } else {
      status =
        `ℹ️ Embed d’ouverture actuel${motif ? ` du motif **${motif.label}**` : ''} (système ${slot}). ` +
        `Ajoute une option (gif, miniature, couleur, titre) pour changer son apparence${motif ? ' pour ce motif' : ', et `motif` pour un seul motif'}. Aperçu :`;
    }
    const hint = '\n-# Choisis un motif dans le menu pour changer son texte d’ouverture.';
    const msg = await interaction.reply({
      ...view(config, motif ?? config.motifs[0], interaction.user, status + hint),
      ephemeral: true,
      fetchReply: true,
    });

    const filter = (i) => i.user.id === interaction.user.id;
    const collector = msg.createMessageComponentCollector({ componentType: ComponentType.StringSelect, time: 600_000, filter });

    collector.on('collect', async (sel) => {
      // Relu à chaque fois : la config a pu changer depuis l'ouverture de la commande.
      const current = getTicketConfig(guildId, key);
      const motif = current?.motifs?.find((m) => m.id === sel.values[0]);
      if (!motif) return sel.reply({ content: '❌ Motif introuvable.', ephemeral: true }).catch(() => {});

      const modalId = `met_modal:${sel.id}`;
      const input = new TextInputBuilder()
        .setCustomId('welcome')
        .setLabel('Texte à l’ouverture du ticket')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(MAX_WELCOME);
      const text = ticketWelcome(current, motif).slice(0, MAX_WELCOME);
      if (text) input.setValue(text);
      await sel.showModal(
        new ModalBuilder()
          .setCustomId(modalId)
          .setTitle(`Ouverture — ${motif.label}`.slice(0, 45))
          .addComponents(new ActionRowBuilder().addComponents(input)),
      );

      const sub = await sel.awaitModalSubmit({ time: 600_000, filter: (i) => i.customId === modalId && filter(i) }).catch(() => null);
      if (!sub) return;
      const welcome = sub.fields.getTextInputValue('welcome').trim();
      if (!welcome) return sub.reply({ content: '❌ Le texte ne peut pas être vide.', ephemeral: true });

      // Mises à jour des tickets ouverts possiblement longues : on accuse réception d'abord.
      await sub.deferUpdate();
      const fresh = getTicketConfig(guildId, key);
      const target = fresh?.motifs?.find((m) => m.id === motif.id);
      if (!target) return sub.followUp({ content: '❌ Ce motif n’existe plus.', ephemeral: true });

      // Texte commun à tous les motifs → passe en texte par motif : les autres
      // gardent le texte commun (repli), seul celui-ci change.
      if (fresh.welcomeMode !== 'per') {
        fresh.welcomeMode = 'per';
        for (const m of fresh.motifs) m.welcome = null;
      }
      target.welcome = welcome;
      setTicketConfig(guildId, fresh, key);
      const updated = await refreshOpenTicketsWelcome(interaction.guild, fresh, target);

      await interaction
        .editReply(
          view(
            fresh,
            target,
            interaction.user,
            `✅ Texte d’ouverture de **${target.label}** mis à jour pour les prochains tickets.` +
              (updated ? `\n🔄 **${updated}** ticket(s) déjà ouvert(s) mis à jour aussi.` : '') +
              hint,
          ),
        )
        .catch(() => {});
    });

    collector.on('end', () => {
      interaction.editReply({ components: [] }).catch(() => {});
    });
  },
};
