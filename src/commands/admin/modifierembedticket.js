import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getTicketConfig, setTicketConfig } from '../../lib/store.js';
import { ticketTitle, ticketWelcome } from '../../lib/tickets.js';

const slotKey = (slot) => (slot === 2 ? 'ticketConfig2' : 'ticketConfig');
const cfgCmd = (slot) => (slot === 2 ? 'configticket2' : 'configticket');
const RESET = 'aucun';

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

// Change l'apparence de l'embed envoyé à l'ouverture d'un ticket (GIF, miniature,
// couleur, titre), pour tous les motifs d'un système. Le texte reste celui de
// /modifdescticketopen. S'applique aux prochains tickets ouverts.
export default {
  data: new SlashCommandBuilder()
    .setName('modifierembedticket')
    .setDescription('Changer l’embed affiché à l’ouverture d’un ticket (GIF, miniature, couleur, titre).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
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
    )
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

    const style = { ...(config.welcomeEmbed ?? {}) };
    const read = (name) => interaction.options.getString(name)?.trim() || null;
    const isReset = (v) => v?.toLowerCase() === RESET;

    for (const [option, field] of [
      ['gif', 'image'],
      ['miniature', 'thumbnail'],
    ]) {
      const value = read(option);
      if (!value) continue;
      if (isReset(value)) {
        delete style[field];
        continue;
      }
      const problem = imageProblem(value);
      if (problem) return interaction.reply({ content: problem, ephemeral: true });
      style[field] = value;
    }

    const color = read('couleur');
    if (isReset(color)) delete style.color;
    else if (color) {
      const hex = parseHex(color);
      if (hex == null) return interaction.reply({ content: `❌ \`${color}\` n’est pas une couleur hex (ex : \`#ff0000\`).`, ephemeral: true });
      style.color = hex;
    }

    const title = read('titre');
    if (isReset(title)) delete style.title;
    else if (title) style.title = title;

    const changed = ['gif', 'miniature', 'couleur', 'titre'].some((name) => read(name));
    if (changed) setTicketConfig(interaction.guild.id, { ...config, welcomeEmbed: style }, key);

    // Aperçu avec le premier motif.
    const motif = config.motifs[0];
    const preview = new EmbedBuilder()
      .setColor(style.color ?? 0x5865f2)
      .setTitle(ticketTitle(style.title, 1, motif.label))
      .setDescription(ticketWelcome(config, motif))
      .addFields({ name: 'Ouvert par', value: `${interaction.user}`, inline: true })
      .setTimestamp();
    if (style.image) preview.setImage(style.image);
    if (style.thumbnail) preview.setThumbnail(style.thumbnail);

    await interaction.reply({
      content: changed
        ? `✅ Embed d’ouverture modifié (système ${slot}). Il s’appliquera aux **prochains** tickets. Aperçu :`
        : `ℹ️ Embed d’ouverture actuel (système ${slot}). Ajoute une option pour le modifier. Aperçu :`,
      embeds: [preview],
      ephemeral: true,
    });
  },
};
