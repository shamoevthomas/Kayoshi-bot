import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} from 'discord.js';
import { getGreetConfig, setGreetConfig } from './store.js';
import { TEMPLATE_HELP } from './greetings.js';

// Créateur d'embed (/embed) : aperçu éphémère + boutons d'édition.
// Sans état : l'embed en cours est relu à chaque clic depuis le message d'aperçu.

const INTRO =
  '🛠️ **Créateur d’embed** — modifie l’aperçu avec les boutons, puis envoie-le ou utilise-le comme message de bienvenue / départ.\n' +
  `-# ${TEMPLATE_HELP} (bienvenue / départ uniquement)`;

const GREET_LABEL = { welcome: 'bienvenue', leave: 'départ' };

export function defaultEmbed() {
  return new EmbedBuilder().setTitle('titre').setDescription('description').setColor(0x5865f2);
}

function builderRows() {
  const edit = (section, label) =>
    new ButtonBuilder().setCustomId(`emb_edit:${section}`).setLabel(label).setStyle(ButtonStyle.Secondary);
  return [
    new ActionRowBuilder().addComponents(
      edit('basic', 'edit basic information (color / title / description)'),
      edit('author', 'edit author'),
      edit('footer', 'edit footer'),
      edit('images', 'edit images'),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('emb_greet:welcome').setLabel('Message de bienvenue').setStyle(ButtonStyle.Primary).setEmoji('👋'),
      new ButtonBuilder().setCustomId('emb_greet:leave').setLabel('Message de départ').setStyle(ButtonStyle.Primary).setEmoji('🚪'),
      new ButtonBuilder().setCustomId('emb_send').setLabel('Envoyer dans ce salon').setStyle(ButtonStyle.Success).setEmoji('📨'),
      new ButtonBuilder().setCustomId('emb_pick').setLabel('Choisir un salon').setStyle(ButtonStyle.Success).setEmoji('📁'),
    ),
  ];
}

export function builderPayload(embed, note = '') {
  return { content: `${INTRO}${note ? `\n\n${note}` : ''}`, embeds: [embed], components: builderRows() };
}

// Ne garde que les champs éditables (retire proxy_url, width, type…), pour
// renvoyer l'embed ou le stocker proprement.
export function cleanEmbed(e) {
  const out = {};
  if (e.title) out.title = e.title;
  if (e.description) out.description = e.description;
  if (e.url) out.url = e.url;
  if (e.color != null) out.color = e.color;
  if (e.author?.name) {
    out.author = { name: e.author.name };
    if (e.author.icon_url) out.author.icon_url = e.author.icon_url;
    if (e.author.url) out.author.url = e.author.url;
  }
  if (e.footer?.text) {
    out.footer = { text: e.footer.text };
    if (e.footer.icon_url) out.footer.icon_url = e.footer.icon_url;
  }
  if (e.thumbnail?.url) out.thumbnail = { url: e.thumbnail.url };
  if (e.image?.url) out.image = { url: e.image.url };
  if (e.fields?.length) out.fields = e.fields.map(({ name, value, inline }) => ({ name, value, inline: !!inline }));
  if (e.timestamp) out.timestamp = e.timestamp;
  return out;
}

function isEmpty(e) {
  return !e.title && !e.description && !e.author && !e.footer && !e.thumbnail && !e.image && !e.fields?.length;
}

function currentEmbed(interaction) {
  const e = interaction.message?.embeds?.[0];
  return e ? cleanEmbed(e.toJSON()) : cleanEmbed(defaultEmbed().toJSON());
}

// --- Formulaires d'édition : [id, label, style, maxLength, valeur actuelle] ---
const SECTIONS = {
  basic: {
    title: 'Informations de base',
    fields: [
      ['color', 'Couleur (hex, ex : #5865F2)', TextInputStyle.Short, 7, (e) => (e.color != null ? `#${e.color.toString(16).padStart(6, '0')}` : '')],
      ['title', 'Titre', TextInputStyle.Short, 256, (e) => e.title],
      ['description', 'Description', TextInputStyle.Paragraph, 4000, (e) => e.description],
    ],
  },
  author: {
    title: 'Auteur',
    fields: [
      ['name', 'Nom de l’auteur (vide = pas d’auteur)', TextInputStyle.Short, 256, (e) => e.author?.name],
      ['icon', 'Lien de l’icône (optionnel)', TextInputStyle.Short, 1000, (e) => e.author?.icon_url],
      ['url', 'Lien sur le nom (optionnel)', TextInputStyle.Short, 1000, (e) => e.author?.url],
    ],
  },
  footer: {
    title: 'Pied de page',
    fields: [
      ['text', 'Texte (vide = pas de pied de page)', TextInputStyle.Paragraph, 2048, (e) => e.footer?.text],
      ['icon', 'Lien de l’icône (optionnel)', TextInputStyle.Short, 1000, (e) => e.footer?.icon_url],
    ],
  },
  images: {
    title: 'Images',
    fields: [
      ['thumbnail', 'Miniature (petite, en haut à droite)', TextInputStyle.Short, 1000, (e) => e.thumbnail?.url],
      ['image', 'Grande image (en bas)', TextInputStyle.Short, 1000, (e) => e.image?.url],
    ],
  },
};

function buildModal(section, embed) {
  const def = SECTIONS[section];
  const modal = new ModalBuilder().setCustomId(`emb_modal:${section}`).setTitle(def.title);
  for (const [id, label, style, max, current] of def.fields) {
    const input = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(false).setMaxLength(max);
    const value = current(embed);
    if (value) input.setValue(String(value).slice(0, max));
    modal.addComponents(new ActionRowBuilder().addComponents(input));
  }
  return modal;
}

// Applique le formulaire soumis à l'embed. Lève une Error (message affiché) si invalide.
function applyModal(section, e, get) {
  const url = (key, label) => {
    const v = get(key);
    if (!v) return null;
    if (!/^https?:\/\/\S+$/.test(v)) throw new Error(`${label} : lien invalide (il doit commencer par http:// ou https://).`);
    return v;
  };

  if (section === 'basic') {
    const color = get('color');
    if (color && !/^#?[0-9a-fA-F]{6}$/.test(color)) throw new Error('Couleur invalide. Exemple : `#5865F2`.');
    if (color) e.color = parseInt(color.replace('#', ''), 16);
    else delete e.color;
    e.title = get('title') || undefined;
    e.description = get('description') || undefined;
  } else if (section === 'author') {
    const name = get('name');
    e.author = name ? { name, icon_url: url('icon', 'Icône') ?? undefined, url: url('url', 'Lien') ?? undefined } : undefined;
  } else if (section === 'footer') {
    const text = get('text');
    e.footer = text ? { text, icon_url: url('icon', 'Icône') ?? undefined } : undefined;
  } else if (section === 'images') {
    const thumb = url('thumbnail', 'Miniature');
    const image = url('image', 'Grande image');
    e.thumbnail = thumb ? { url: thumb } : undefined;
    e.image = image ? { url: image } : undefined;
  }
  const cleaned = cleanEmbed(e);
  if (isEmpty(cleaned)) throw new Error('L’embed ne peut pas être vide : garde au moins un titre, une description, un auteur, un pied de page ou une image.');
  return cleaned;
}

function saveGreeting(guildId, type, channelId, embed) {
  const prev = getGreetConfig(guildId, type);
  // L'embed remplace le message texte / GIF ; le ping de rôle éventuel est conservé.
  setGreetConfig(guildId, type, { channelId, message: null, gifUrl: null, pingRoleId: prev?.pingRoleId ?? null, embed });
  return `✅ Cet embed est maintenant le **message de ${GREET_LABEL[type]}**, envoyé dans <#${channelId}>.`;
}

const errorReply = (interaction, text) => interaction.reply({ content: `❌ ${text}`, ephemeral: true }).catch(() => {});

// Routeur des interactions du créateur d'embed (préfixe "emb_").
export async function handleEmbedBuilderInteraction(interaction) {
  const [action, arg] = (interaction.customId ?? '').split(':');

  // --- Bouton d'édition → formulaire pré-rempli ---
  if (interaction.isButton() && action === 'emb_edit' && SECTIONS[arg]) {
    return interaction.showModal(buildModal(arg, currentEmbed(interaction)));
  }

  // --- Formulaire soumis → aperçu mis à jour ---
  if (interaction.isModalSubmit() && action === 'emb_modal' && SECTIONS[arg]) {
    let embed;
    try {
      embed = applyModal(arg, currentEmbed(interaction), (k) => interaction.fields.getTextInputValue(k)?.trim() ?? '');
    } catch (err) {
      return errorReply(interaction, err.message);
    }
    return interaction.update(builderPayload(embed)).catch((err) => errorReply(interaction, `Discord a refusé l’embed : ${err.message}`));
  }

  // --- Envoyer l'embed dans le salon ---
  if (interaction.isButton() && action === 'emb_send') {
    const embed = currentEmbed(interaction);
    const sent = await interaction.channel.send({ embeds: [embed] }).then(() => true).catch(() => false);
    if (!sent) return errorReply(interaction, 'Impossible d’envoyer l’embed ici (permissions ?).');
    return interaction.update(builderPayload(embed, '✅ Embed envoyé dans ce salon.'));
  }

  // --- Choisir le salon d'envoi → menu, l'aperçu reste affiché ---
  if (interaction.isButton() && action === 'emb_pick') {
    return interaction.update({
      content: '📁 Dans quel salon envoyer l’embed ?',
      embeds: [currentEmbed(interaction)],
      components: [
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId('emb_sendchan')
            .setPlaceholder('Choisis un salon')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('emb_back').setLabel('Retour').setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
  }

  if (interaction.isChannelSelectMenu() && action === 'emb_sendchan') {
    const embed = currentEmbed(interaction);
    const channel = await interaction.guild.channels.fetch(interaction.values[0]).catch(() => null);
    // Pas d'envoi via le bot dans un salon où le membre ne peut pas écrire lui-même.
    if (!channel?.permissionsFor(interaction.member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
      return errorReply(interaction, 'Tu ne peux pas écrire dans ce salon.');
    }
    const sent = await channel.send({ embeds: [embed] }).then(() => true).catch(() => false);
    if (!sent) return errorReply(interaction, `Impossible d’envoyer l’embed dans ${channel} (permissions ?).`);
    return interaction.update(builderPayload(embed, `✅ Embed envoyé dans ${channel}.`));
  }

  // --- Utiliser comme message de bienvenue / départ ---
  if (interaction.isButton() && action === 'emb_greet' && GREET_LABEL[arg]) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return errorReply(interaction, 'Il faut être administrateur pour changer le message de bienvenue / départ.');
    }
    const embed = currentEmbed(interaction);
    const channelId = getGreetConfig(interaction.guild.id, arg)?.channelId;
    const channel = channelId && (await interaction.guild.channels.fetch(channelId).catch(() => null));
    if (channel) return interaction.update(builderPayload(embed, saveGreeting(interaction.guild.id, arg, channel.id, embed)));

    // Aucun salon configuré (ou supprimé) → choix du salon, l'aperçu reste affiché.
    return interaction.update({
      content: `📁 Dans quel salon envoyer le message de ${GREET_LABEL[arg]} ?`,
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId(`emb_greetchan:${arg}`)
            .setPlaceholder('Choisis un salon')
            .addChannelTypes(ChannelType.GuildText),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('emb_back').setLabel('Retour').setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
  }

  if (interaction.isChannelSelectMenu() && action === 'emb_greetchan' && GREET_LABEL[arg]) {
    const embed = currentEmbed(interaction);
    return interaction.update(builderPayload(embed, saveGreeting(interaction.guild.id, arg, interaction.values[0], embed)));
  }

  if (interaction.isButton() && action === 'emb_back') {
    return interaction.update(builderPayload(currentEmbed(interaction)));
  }
}
