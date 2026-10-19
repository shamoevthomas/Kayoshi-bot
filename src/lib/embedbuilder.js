import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
  parseEmoji,
} from 'discord.js';
import {
  getGreetEmbed,
  setGreetEmbed,
  getPartner,
  patchPartner,
  getTicketConfig,
  setTicketConfig,
  getSentEmbeds,
  recordSentEmbed,
  removeSentEmbed,
} from './store.js';
import { TEMPLATE_HELP, renderEmbedFor } from './greetings.js';
import {
  buildTicketPanel,
  refreshTicketPanel,
  syncMotifCategoryName,
  ticketPanelSlot,
  rememberTicketPanel,
  createCategories,
} from './tickets.js';

// Créateur d'embed (/embed, et /modifierembed pour un embed existant) : aperçu éphémère + boutons d'édition.
// Sans état : l'embed en cours est relu à chaque clic depuis le message d'aperçu,
// et le rôle du mode partenariat depuis son texte (seule mention de rôle qu'il contient).

const INTRO =
  '🛠️ **Créateur d’embed** — modifie l’aperçu avec les boutons, puis envoie-le ou utilise-le comme message de bienvenue / départ.\n' +
  `-# ${TEMPLATE_HELP} — affichés tels quels dans l’aperçu, remplacés à l’envoi.`;

const GREET_LABEL = { welcome: 'bienvenue', leave: 'départ' };
const GREET_CMD = { welcome: '/bienvenue', leave: '/quitte' };

export function defaultEmbed() {
  return new EmbedBuilder().setTitle('titre').setDescription('description').setColor(0x5865f2);
}

// --- Role-react : boutons et sélecteur de rôles ajoutés sous l'embed envoyé ---
// Dans l'aperçu, ils sont affichés tels quels (boutons "emb_rrdel:<rôle>", sélecteur
// "emb_rsdel" : un clic sur un bouton ou une option le retire). C'est leur seule copie,
// relue à chaque clic comme l'embed. Sur le message envoyé ("emb_role:<rôle>", "emb_rsel"),
// choisir un rôle le donne, le rechoisir le retire.

// Un rôle en libre-service ne doit jamais porter de permission de modération.
const UNSAFE_PERMS = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.ManageMessages,
];

const NO_ROLE_REACT = { buttons: [], options: [] };
const MAX_OPTIONS = 25;
// 2 rangées sur les 5 du message (les 3 autres servent à l'aperçu) : le sélecteur en prend une entière.
const maxRoleButtons = (rr) => (rr.options.length ? 5 : 10);
const hasRoleReact = (rr) => rr.buttons.length > 0 || rr.options.length > 0;

function cleanEmoji(emoji) {
  if (!emoji) return undefined;
  const { id, name, animated } = emoji;
  return id ? { id, name, animated: !!animated } : { name };
}

// mode : 'preview' (un clic retire), 'disabled' (aperçu inactif) ou 'live' (message envoyé).
function roleReactRows({ buttons, options }, mode) {
  const live = mode === 'live';
  const disabled = mode === 'disabled';
  const rows = [];
  if (options.length) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(live ? 'emb_rsel' : 'emb_rsdel')
          .setPlaceholder(live ? '🎭 Choisis un rôle' : '🗑️ Aperçu du sélecteur : choisis une option pour la retirer')
          .setDisabled(disabled)
          .addOptions(options),
      ),
    );
  }
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        buttons.slice(i, i + 5).map(({ roleId, emoji, label }) => {
          const button = new ButtonBuilder()
            .setCustomId(`${live ? 'emb_role' : 'emb_rrdel'}:${roleId}`)
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(disabled);
          if (emoji) button.setEmoji(emoji);
          if (label) button.setLabel(label);
          return button;
        }),
      ),
    );
  }
  return rows;
}

function cleanOption({ label, value, description, emoji }) {
  const option = { label, value };
  if (description) option.description = description;
  if (emoji) option.emoji = cleanEmoji(emoji);
  return option;
}

const selectOptions = (components, customId) => (components.find((c) => c.customId === customId)?.options ?? []).map(cleanOption);

// Boutons et sélecteur de rôles d'une liste de composants : l'aperçu ("emb_rrdel:" / "emb_rsdel")
// ou un message envoyé ("emb_role:" / "emb_rsel").
function readRoleReact(components, buttonPrefix, selectId) {
  const buttons = components
    .filter((c) => c.customId?.startsWith(buttonPrefix))
    .map((c) => ({ roleId: c.customId.slice(buttonPrefix.length), emoji: cleanEmoji(c.emoji), label: c.label ?? undefined }));
  return { buttons, options: selectOptions(components, selectId) };
}

// "<:nom:id>" / "<a:nom:id>" ou l'emoji unicode, comme les motifs de tickets le stockent.
function emojiText(emoji) {
  if (!emoji) return '';
  return emoji.id ? `<${emoji.animated ? 'a' : ''}:${emoji.name}:${emoji.id}>` : emoji.name;
}

// Accepte <:nom:id>, :nom:, nom ou id d'un emoji du serveur, ou un emoji classique.
function emojiFromInput(interaction, input) {
  const custom = input.match(/^<(a?):(\w{2,32}):(\d{17,20})>$/);
  if (custom) {
    if (!interaction.client.emojis.cache.has(custom[3])) {
      throw new Error('Je n’ai pas accès à cet emoji : il doit venir d’un serveur où je suis.');
    }
    return { id: custom[3], name: custom[2], animated: !!custom[1] };
  }
  const key = input.replace(/^:|:$/g, '');
  const emojis = interaction.guild.emojis.cache;
  const found =
    emojis.get(key) ?? emojis.find((e) => e.name === key) ?? emojis.find((e) => e.name?.toLowerCase() === key.toLowerCase());
  if (found) return { id: found.id, name: found.name, animated: !!found.animated };
  if (/^\w+$/.test(key)) throw new Error(`Emoji « ${input} » introuvable sur le serveur.`);
  if (/\s/.test(input) || !/\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(input)) {
    throw new Error(`« ${input} » n’est pas un emoji. Mets un seul emoji (ex : 🎮) ou le nom d’un emoji du serveur.`);
  }
  return { name: input };
}

// Raison pour laquelle le bot ne doit pas donner ce rôle en libre-service (null si OK).
function roleProblem(role) {
  if (!role) return 'Ce rôle n’existe plus.';
  if (role.id === role.guild.id) return '@everyone n’est pas possible ici.';
  if (role.managed) return `**@${role.name}** est géré par une intégration (bot, boost…) : personne ne peut le recevoir.`;
  if (role.permissions.any(UNSAFE_PERMS)) {
    return `**@${role.name}** a des permissions de modération ou d’administration : il ne peut pas être en libre-service.`;
  }
  if (!role.editable) {
    return `Je ne peux pas donner **@${role.name}** : il me faut la permission « Gérer les rôles » et mon rôle doit être au-dessus de lui.`;
  }
  return null;
}

// Donne le rôle, ou le retire si le membre l'a déjà. Renvoie le message à lui afficher.
async function toggleRole(interaction, roleId) {
  const role = interaction.guild.roles.cache.get(roleId);
  const problem = roleProblem(role);
  if (problem) return `❌ ${problem}`;
  const { member } = interaction;
  const had = member.roles.cache.has(role.id);
  const done = await (had ? member.roles.remove(role, 'Role-react') : member.roles.add(role, 'Role-react'))
    .then(() => true)
    .catch(() => false);
  if (!done) return `❌ Impossible de ${had ? 'retirer' : 'donner'} le rôle ${role} pour le moment.`;
  return had ? `➖ Rôle ${role} retiré.` : `✅ Tu as reçu le rôle ${role}.`;
}

// Formulaires : "button" (rôle, emoji, texte) ou "select" (rôle, emoji, titre, description).
const ROLE_REACT_KIND = { emb_rr: 'button', emb_rrmodal: 'button', emb_rs: 'select', emb_rsmodal: 'select' };
const EMOJI_HELP = 'Nom d’un emoji du serveur (ex : etoile ou :etoile:), <:nom:id>, ou emoji classique';

function roleReactModal(kind) {
  const text = (id, required, max, placeholder) =>
    new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(max).setPlaceholder(placeholder);
  const role = new LabelBuilder()
    .setLabel('Rôle à donner')
    .setRoleSelectMenuComponent(new RoleSelectMenuBuilder().setCustomId('role').setPlaceholder('Choisis le rôle'));
  if (kind === 'button') {
    return new ModalBuilder()
      .setCustomId('emb_rrmodal')
      .setTitle('Role-react : bouton')
      .addLabelComponents(
        role,
        new LabelBuilder().setLabel('Emoji').setDescription(EMOJI_HELP).setTextInputComponent(text('emoji', true, 100, '🎮')),
        new LabelBuilder()
          .setLabel('Texte du bouton (optionnel)')
          .setDescription('Vide = nom du rôle')
          .setTextInputComponent(text('label', false, 80, 'Notifications')),
      );
  }
  return new ModalBuilder()
    .setCustomId('emb_rsmodal')
    .setTitle('Role-react : sélecteur')
    .addLabelComponents(
      role,
      new LabelBuilder().setLabel('Emoji (optionnel)').setDescription(EMOJI_HELP).setTextInputComponent(text('emoji', false, 100, '🎮')),
      new LabelBuilder().setLabel('Titre').setTextInputComponent(text('label', true, 100, 'Notifications')),
      new LabelBuilder()
        .setLabel('Description (optionnel)')
        .setTextInputComponent(text('description', false, 100, 'Être prévenu des annonces du serveur')),
    );
}

const upsert = (list, index, item) => (index < 0 ? [...list, item] : list.map((x, i) => (i === index ? item : x)));

// Ajoute le bouton ou l'option du formulaire soumis (le remplace si le rôle y est déjà).
function applyRoleReactModal(interaction, kind, rr) {
  const { guild, member } = interaction;
  // Comme pour l'envoi dans un salon : rien via le bot que le membre ne pourrait pas faire lui-même.
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    throw new Error('Il te faut la permission « Gérer les rôles » pour créer un role-react.');
  }
  const role = guild.roles.cache.get(interaction.fields.getSelectedRoles('role', true).first().id);
  const problem = roleProblem(role);
  if (problem) throw new Error(problem);
  if (guild.ownerId !== member.id && role.comparePositionTo(member.roles.highest) >= 0) {
    throw new Error(`**@${role.name}** est au niveau ou au-dessus de ton rôle le plus haut.`);
  }

  const get = (k) => interaction.fields.getTextInputValue(k)?.trim() ?? '';
  if (kind === 'button') {
    const index = rr.buttons.findIndex((b) => b.roleId === role.id);
    const max = maxRoleButtons(rr);
    if (index < 0 && rr.buttons.length >= max) {
      throw new Error(`${max} boutons de rôle maximum${rr.options.length ? ' avec un sélecteur' : ''} : retire-en un d’abord.`);
    }
    const button = { roleId: role.id, emoji: emojiFromInput(interaction, get('emoji')), label: get('label') || role.name.slice(0, 80) };
    return { ...rr, buttons: upsert(rr.buttons, index, button) };
  }

  const index = rr.options.findIndex((o) => o.value === role.id);
  if (index < 0 && rr.options.length >= MAX_OPTIONS) throw new Error(`${MAX_OPTIONS} options maximum dans le sélecteur : retires-en une d’abord.`);
  if (!rr.options.length && rr.buttons.length > 5) {
    throw new Error('Le sélecteur prend une rangée entière : avec lui, 5 boutons de rôle maximum. Retire des boutons d’abord.');
  }
  const option = { label: get('label'), value: role.id };
  if (get('description')) option.description = get('description');
  if (get('emoji')) option.emoji = emojiFromInput(interaction, get('emoji'));
  return { ...rr, options: upsert(rr.options, index, option) };
}

// --- Modification d'un embed existant (/modifierembed) ---
// La cible est gardée dans l'id du bouton 💾 ("emb_save:<cible>") :
//   m.<salon>.<message>  embed envoyé par le bot (role-react possible)
//   e.<salon>.<message>  message du bot qui a d'autres composants : seul l'embed est modifié
//   partner · greet.welcome · greet.leave · ticket.1 · ticket.2
const TICKET_KEY = { 1: 'ticketConfig', 2: 'ticketConfig2' };

function targetLabel(target) {
  const [type, a] = target.split('.');
  if (type === 'm' || type === 'e') return `Modification de l’embed envoyé dans <#${a}>`;
  if (type === 'partner') return 'Modification de l’embed Partenariat (envoi automatique)';
  if (type === 'greet') return `Modification de l’embed de ${GREET_LABEL[a]}`;
  return `Modification du panneau Ouverture de ticket (système ${a})`;
}

// État de l'aperçu : rôle du mode partenariat, role-react, cible modifiée et motifs du panneau de tickets.
function builderRows({ role: roleId = null, rr = NO_ROLE_REACT, target = null, motifs = [] }) {
  const edit = (section, label) =>
    new ButtonBuilder().setCustomId(`emb_edit:${section}`).setLabel(label).setStyle(ButtonStyle.Secondary);
  const editRow = new ActionRowBuilder().addComponents(
    edit('basic', 'edit basic information (color / title / description)'),
    edit('author', 'edit author'),
    edit('footer', 'edit footer'),
    edit('images', 'edit images'),
  );
  const roleReactTools = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('emb_rr').setLabel('role-react : bouton').setStyle(ButtonStyle.Primary).setEmoji('🎭'),
      new ButtonBuilder().setCustomId('emb_rs').setLabel('role-react : sélecteur').setStyle(ButtonStyle.Primary).setEmoji('📋'),
    ),
    ...roleReactRows(rr, 'preview'),
  ];

  if (target) {
    const type = target.split('.')[0];
    const extra = [];
    if (type === 'm') extra.push(...roleReactTools);
    if (type === 'ticket') {
      extra.push(
        new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId('emb_tmotif')
            .setPlaceholder('🎫 Sélecteur du panneau : choisis un motif pour le modifier ou le supprimer')
            .addOptions(motifs),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('emb_tmotifadd')
            .setLabel('Ajouter un motif')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('➕')
            .setDisabled(motifs.length >= MAX_OPTIONS),
        ),
      );
    }
    return [
      editRow,
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`emb_save:${target}`)
          .setLabel('Enregistrer les modifications')
          .setStyle(ButtonStyle.Success)
          .setEmoji('💾'),
        ...(type === 'm' || type === 'ticket'
          ? [new ButtonBuilder().setCustomId('emb_resend').setLabel('Renvoyer').setStyle(ButtonStyle.Primary).setEmoji('📨')]
          : []),
      ),
      ...extra,
    ];
  }

  // Mode partenariat : salon où l'embed est envoyé après chaque message.
  // Ses 2 rangées prennent la place du role-react, qui n'y est pas proposé.
  const modeRows = roleId
    ? [
        new ActionRowBuilder().addComponents(
          new ChannelSelectMenuBuilder()
            .setCustomId('emb_partnerchan')
            .setPlaceholder('📌 Salon partenariat : embed envoyé après chaque message')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('emb_partneroff').setLabel('Désactiver l’envoi automatique').setStyle(ButtonStyle.Danger),
        ),
      ]
    : roleReactTools;
  return [
    editRow,
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('emb_greet:welcome').setLabel('Message de bienvenue').setStyle(ButtonStyle.Primary).setEmoji('👋'),
      new ButtonBuilder().setCustomId('emb_greet:leave').setLabel('Message de départ').setStyle(ButtonStyle.Primary).setEmoji('🚪'),
      new ButtonBuilder().setCustomId('emb_partner').setLabel('Partenariat').setStyle(ButtonStyle.Primary).setEmoji('🤝'),
      new ButtonBuilder().setCustomId('emb_send').setLabel('Envoyer dans ce salon').setStyle(ButtonStyle.Success).setEmoji('📨'),
      new ButtonBuilder().setCustomId('emb_pick').setLabel('Choisir un salon').setStyle(ButtonStyle.Success).setEmoji('📁'),
    ),
    ...modeRows,
  ];
}

// Ligne qui garde le rôle à mentionner dans le texte de l'aperçu (mode partenariat).
function withRole(text, roleId) {
  return roleId ? `${text}\n\n🤝 **Partenariat** — <@&${roleId}> sera mentionné au-dessus de l’embed à l’envoi.` : text;
}

function currentState(interaction) {
  const components = (interaction.message?.components ?? []).flatMap((row) => row.components ?? []);
  return {
    role: interaction.message?.content?.match(/<@&(\d+)>/)?.[1] ?? null,
    rr: readRoleReact(components, 'emb_rrdel:', 'emb_rsdel'),
    target: components.find((c) => c.customId?.startsWith('emb_save:'))?.customId.slice('emb_save:'.length) ?? null,
    motifs: selectOptions(components, 'emb_tmotif'),
  };
}

// Les notes ne doivent pas contenir de mention de rôle : currentState() lit la première du texte.
export function builderPayload(embed, note = '', state = {}) {
  const { role = null, rr = NO_ROLE_REACT, target = null } = state;
  const type = target?.split('.')[0];
  // Le panneau de tickets n'est pas passé par les templates.
  const intro = !target
    ? withRole(INTRO, role)
    : `✏️ **${targetLabel(target)}** — modifie l’aperçu, puis clique sur 💾 **Enregistrer les modifications**` +
      (type === 'm' || type === 'ticket' ? ', ou sur 📨 **Renvoyer** pour l’envoyer en nouveau message.' : '.') +
      (type === 'ticket' ? '' : `\n-# ${TEMPLATE_HELP}`);
  const hints = [];
  if (hasRoleReact(rr)) {
    hints.push(
      `🎭 **Role-react** — ajouté sous l’embed ${target ? 'à l’enregistrement (💾)' : 'à l’envoi (📨 / 📁)'} : choisir un rôle le donne, le rechoisir le retire.\n` +
        '-# Clique sur un bouton ou une option de l’aperçu pour le retirer. Pas de role-react sur les messages de bienvenue / départ.',
    );
  }
  if (type === 'ticket') {
    hints.push(
      '🎫 Choisis un motif dans le sélecteur pour changer son emoji, son titre ou sa description (titre vide = le supprimer), ou ➕ pour en ajouter un.\n' +
        '-# Un nouveau motif a sa catégorie, le texte d’ouverture commun et le staff global : change son texte avec `/modifierembedticket`.',
    );
  }
  if (type === 'e') hints.push('-# Ce message a d’autres boutons ou menus : ils sont gardés tels quels, seul l’embed est modifié.');
  return {
    content: [intro, ...hints, note].filter(Boolean).join('\n\n'),
    embeds: [embed],
    components: builderRows(state),
    allowedMentions: { parse: [] },
  };
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

// --- Partenariat : rôle à mentionner + embed « Nouveau Partenaire ! » ---
function partnerModal(embed, roleId) {
  const text = (id, style, max, required, value, placeholder) => {
    const input = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(required).setMaxLength(max);
    if (value) input.setValue(String(value).slice(0, max));
    if (placeholder) input.setPlaceholder(placeholder);
    return input;
  };
  const roles = new RoleSelectMenuBuilder().setCustomId('role').setPlaceholder('Choisis le rôle à notifier');
  if (roleId) roles.setDefaultRoles(roleId);
  // Premier passage : modèle de partenariat ; ensuite, les valeurs de l'aperçu.
  const title = roleId ? embed.title : 'Nouveau Partenaire !';
  const description = roleId ? embed.description : 'Merci [user] pour ce partenariat.\nTotale de partenariat effectué : [nump].';
  return new ModalBuilder()
    .setCustomId('emb_partnermodal')
    .setTitle('Partenariat')
    .addLabelComponents(
      new LabelBuilder().setLabel('Rôle à mentionner').setRoleSelectMenuComponent(roles),
      new LabelBuilder().setLabel('Titre').setTextInputComponent(text('title', TextInputStyle.Short, 256, true, title)),
      new LabelBuilder()
        .setLabel('Description')
        .setTextInputComponent(text('description', TextInputStyle.Paragraph, 4000, true, description, '➜ Merci … pour ce partenariat ! ★')),
      new LabelBuilder()
        .setLabel('Grande image / GIF (en bas)')
        .setDescription('Lien en https:// (optionnel)')
        .setTextInputComponent(text('image', TextInputStyle.Short, 1000, false, embed.image?.url)),
      new LabelBuilder()
        .setLabel('Miniature / petit GIF (en haut à droite)')
        .setDescription('Lien en https:// (optionnel)')
        .setTextInputComponent(text('thumbnail', TextInputStyle.Short, 1000, false, embed.thumbnail?.url)),
    );
}

// Auteur = membre qui crée l'embed, avec l'heure (pas de pied de page par défaut).
// Auteur et pied de page déjà définis sont gardés (modifiables avec les autres boutons).
function applyPartnerModal(interaction, e) {
  const { guild, member } = interaction;
  const role = interaction.fields.getSelectedRoles('role', true).first();
  if (role.id === guild.id) throw new Error('Choisis un rôle précis : @everyone n’est pas possible ici.');
  // Comme pour les salons : pas de mention via le bot que le membre ne pourrait pas faire lui-même.
  const canPing = (perms) => role.mentionable || perms?.has(PermissionFlagsBits.MentionEveryone);
  if (!canPing(interaction.memberPermissions)) {
    throw new Error(`Le rôle **@${role.name}** n’est pas mentionnable et tu n’as pas la permission de le mentionner.`);
  }

  const get = (k) => interaction.fields.getTextInputValue(k)?.trim() ?? '';
  e.title = get('title') || undefined;
  e.description = get('description') || undefined;
  e.author ??= { name: member.displayName, icon_url: member.displayAvatarURL() };
  e.timestamp = new Date().toISOString();
  const embed = applyModal('images', e, get); // valide les liens des images

  const note = canPing(guild.members.me?.permissions)
    ? ''
    : `⚠️ **@${role.name}** n’est pas mentionnable et le bot n’a pas la permission « Mentionner @everyone, @here et tous les rôles » : la mention s’affichera sans notifier personne.`;
  return { embed, roleId: role.id, note };
}

// Point de départ du formulaire partenariat : l'aperçu s'il est déjà en mode
// partenariat, sinon l'embed partenariat enregistré (pour le modifier), sinon l'aperçu.
function partnerBase(interaction, roleId) {
  const saved = getPartner(interaction.guild.id);
  if (!roleId && saved.embed) return { embed: structuredClone(saved.embed), roleId: saved.roleId };
  return { embed: currentEmbed(interaction), roleId };
}

// Message envoyé : templates remplacés, heure d'envoi, role-react, et mention du rôle en mode partenariat.
async function outgoing(interaction, embed, roleId, rr) {
  const rendered = await renderEmbedFor(interaction.guild, interaction.user, embed);
  if (rendered.timestamp) rendered.timestamp = new Date().toISOString();
  const components = roleReactRows(rr, 'live');
  if (!roleId) return { embeds: [rendered], components };
  return { content: `<@&${roleId}>`, embeds: [rendered], components, allowedMentions: { roles: [roleId] } };
}

// L'embed est stocké à part : le message texte de /bienvenue ou /quitte n'est pas touché.
function saveGreeting(guildId, type, channelId, embed) {
  setGreetEmbed(guildId, type, { channelId, embed });
  return `✅ Cet embed est maintenant l’**embed de ${GREET_LABEL[type]}**, envoyé dans <#${channelId}>.\n-# Le message texte de ${GREET_CMD[type]} reste inchangé et est envoyé à part.`;
}

// --- /modifierembed : liste, chargement et enregistrement des embeds existants ---

function embedName(embed) {
  return (embed.title || embed.author?.name || embed.description?.split('\n')[0] || 'Embed sans titre').slice(0, 60);
}

// Mémorise un embed envoyé avec le créateur pour le proposer dans /modifierembed.
function trackSentEmbed(message, embed) {
  recordSentEmbed(message.guildId, message.id, { channelId: message.channelId, title: embedName(embed), ts: message.createdTimestamp });
}

function requireAdmin(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    throw new Error('Il faut être administrateur pour modifier cet embed.');
  }
}

// Message du bot avec un embed, dans un salon où le membre peut écrire.
// Salon de l'embed, si le membre peut y écrire (comme pour l'envoi avec /embed).
async function writableChannel(interaction, channelId, messageId = null) {
  const { guild } = interaction;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    if (messageId) removeSentEmbed(guild.id, messageId);
    throw new Error('Le salon de cet embed n’existe plus.');
  }
  if (!channel.permissionsFor(interaction.member)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) {
    throw new Error(`Tu ne peux pas écrire dans ${channel}.`);
  }
  return channel;
}

async function fetchOwnMessage(interaction, channelId, messageId) {
  const { guild } = interaction;
  const channel = await writableChannel(interaction, channelId, messageId);
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message) {
    removeSentEmbed(guild.id, messageId);
    throw new Error('Message introuvable : il a sans doute été supprimé.');
  }
  if (message.author.id !== interaction.client.user.id) throw new Error('Je ne peux modifier que mes propres messages.');
  if (!message.embeds.length) throw new Error('Ce message n’a pas d’embed.');
  return message;
}

// Choix proposés par /modifierembed (autocomplétion), filtrés par le texte tapé.
export function embedEditorChoices(interaction) {
  const { guild } = interaction;
  const query = interaction.options.getFocused().toLowerCase();
  const choices = [];
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    if (getPartner(guild.id).embed) choices.push({ name: '🤝 Partenariat (envoi automatique)', value: 'partner' });
    for (const [type, emoji] of [['welcome', '👋'], ['leave', '🚪']]) {
      if (getGreetEmbed(guild.id, type)?.embed) choices.push({ name: `${emoji} Embed de ${GREET_LABEL[type]}`, value: `greet.${type}` });
    }
    for (const slot of [1, 2]) {
      if (getTicketConfig(guild.id, TICKET_KEY[slot])?.motifs?.length) {
        choices.push({ name: `🎫 Ouverture de ticket — panneau et sélecteur (système ${slot})`, value: `ticket.${slot}` });
      }
    }
  }
  const sent = Object.entries(getSentEmbeds(guild.id)).sort(([, a], [, b]) => b.ts - a.ts);
  for (const [messageId, { channelId, title }] of sent) {
    const channel = guild.channels.cache.get(channelId);
    choices.push({ name: `📨 ${title} · #${channel?.name ?? 'salon supprimé'}`.slice(0, 100), value: `m.${channelId}.${messageId}` });
  }
  return choices.filter((c) => c.name.toLowerCase().includes(query)).slice(0, 25);
}

// Embed et état de l'aperçu pour la cible choisie (ou un lien de message). Lève une Error si impossible.
async function loadTarget(interaction, value) {
  const { guild } = interaction;
  const link = value.match(/discord(?:app)?\.com\/channels\/(\d+)\/(\d+)\/(\d+)/);
  if (link && link[1] !== guild.id) throw new Error('Ce message est sur un autre serveur.');
  let [type, a, b] = (link ? `m.${link[2]}.${link[3]}` : value).split('.');

  if (type === 'm' && a && b) {
    const message = await fetchOwnMessage(interaction, a, b);
    // Le panneau de tickets se modifie avec ses motifs, même ouvert par son lien
    // (et ce message devient le panneau enregistré du système).
    const panelSlot = ticketPanelSlot(message);
    const panelConfig = panelSlot && getTicketConfig(guild.id, TICKET_KEY[panelSlot]);
    if (panelConfig?.motifs?.length) {
      requireAdmin(interaction);
      rememberTicketPanel(guild, panelConfig, panelSlot, message);
      [type, a] = ['ticket', String(panelSlot)];
    } else {
      const embed = cleanEmbed(message.embeds[0].toJSON());
      const components = message.components.flatMap((row) => row.components ?? []);
      const roleReactOnly = components.every((c) => c.customId?.startsWith('emb_role:') || c.customId === 'emb_rsel');
      if (!roleReactOnly) return { embed, state: { target: `e.${a}.${b}` } };
      return { embed, state: { target: `m.${a}.${b}`, rr: readRoleReact(components, 'emb_role:', 'emb_rsel') } };
    }
  }

  if (type === 'partner') {
    requireAdmin(interaction);
    const { embed } = getPartner(guild.id);
    if (!embed) throw new Error('Aucun embed partenariat enregistré : crée-le avec `/embed` → 🤝 Partenariat.');
    return { embed: structuredClone(embed), state: { target: 'partner' } };
  }

  if (type === 'greet' && GREET_LABEL[a]) {
    requireAdmin(interaction);
    const current = getGreetEmbed(guild.id, a);
    if (!current?.embed) throw new Error(`Aucun embed de ${GREET_LABEL[a]} : crée-le avec \`/embed\`.`);
    return { embed: structuredClone(current.embed), state: { target: `greet.${a}` } };
  }

  if (type === 'ticket' && TICKET_KEY[a]) {
    requireAdmin(interaction);
    const config = getTicketConfig(guild.id, TICKET_KEY[a]);
    if (!config?.motifs?.length) throw new Error(`Aucun panneau de tickets pour le système ${a} : lance d’abord \`/configticket\`.`);
    const embed = cleanEmbed(buildTicketPanel(config, Number(a)).embeds[0].toJSON());
    const motifs = config.motifs.map((m) =>
      cleanOption({ label: m.label, value: m.id, description: m.description, emoji: m.emoji ? parseEmoji(m.emoji) : null }),
    );
    return { embed, state: { target: `ticket.${a}`, motifs } };
  }

  throw new Error('Embed introuvable : choisis-le dans la liste, ou colle le lien du message (clic droit → Copier le lien du message).');
}

export async function openEmbedEditor(interaction, value) {
  let loaded;
  try {
    loaded = await loadTarget(interaction, value.trim());
  } catch (err) {
    return interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
  }
  return interaction.reply({ ...builderPayload(loaded.embed, '', loaded.state), ephemeral: true });
}

// Applique l'aperçu à la cible. Renvoie la note à afficher, lève une Error si impossible.
async function saveTarget(interaction, embed, { target, rr, motifs }) {
  const { guild } = interaction;
  const [type, a, b] = target.split('.');

  if (type === 'm' || type === 'e') {
    const message = await fetchOwnMessage(interaction, a, b);
    const rendered = await renderEmbedFor(guild, interaction.user, embed);
    // Les autres embeds et, pour "e", les composants du message ne sont pas touchés.
    const edit = { embeds: [rendered, ...message.embeds.slice(1)] };
    if (type === 'm') edit.components = roleReactRows(rr, 'live');
    await message.edit(edit).catch((err) => {
      throw new Error(`Discord a refusé la modification : ${err.message}`);
    });
    if (type === 'm') trackSentEmbed(message, embed);
    return `✅ Embed modifié : ${message.url}`;
  }

  requireAdmin(interaction);
  if (type === 'partner') {
    patchPartner(guild.id, { embed });
    return '✅ Embed partenariat enregistré : il sera utilisé pour les prochains partenariats.';
  }

  if (type === 'greet') {
    const current = getGreetEmbed(guild.id, a);
    if (!current) throw new Error(`L’embed de ${GREET_LABEL[a]} a été désactivé entre-temps : recrée-le avec \`/embed\`.`);
    setGreetEmbed(guild.id, a, { ...current, embed });
    return `✅ Embed de ${GREET_LABEL[a]} enregistré.`;
  }

  const slot = Number(a);
  const { config, summary } = await applyTicketPanel(guild, slot, embed, motifs);
  // Panneau supprimé : republié dans son salon.
  const refreshed = await refreshTicketPanel(guild, config, slot, { repost: true });
  const details = summary ? ` (${summary})` : '';
  if (refreshed === 'edited') return `✅ Panneau de tickets mis à jour${details}.`;
  if (refreshed === 'posted') return `✅ Panneau introuvable : je l’ai republié dans <#${config.panelChannelId}>${details}.`;
  return (
    '⚠️ Modifications enregistrées, mais je n’ai pas pu mettre à jour le panneau : son salon n’existe plus ou je n’ai pas la permission d’y écrire.\n' +
    '-# Si le panneau est dans un autre salon, colle le lien de son message dans `/modifierembed` puis clique sur 💾.'
  );
}

// Panneau de tickets : embed complet + motifs de l'aperçu (ajoutés, modifiés, supprimés).
// Renvoie { config, summary } (summary = ce qui a changé pour les catégories, ou '').
async function applyTicketPanel(guild, slot, embed, motifs) {
  const config = getTicketConfig(guild.id, TICKET_KEY[slot]);
  if (!config?.motifs?.length) throw new Error(`Le système de tickets ${slot} n’est plus configuré.`);
  config.panelEmbed = embed;
  config.panelTitle = embed.title ?? '';
  config.panelDescription = embed.description ?? '';
  config.panelColor = embed.color ?? null;
  config.panelImage = embed.image?.url ?? null;

  // Les motifs suivent l'aperçu ; un nouveau motif a le staff global et le texte d'ouverture commun.
  const before = config.motifs;
  const removed = before.filter((m) => !motifs.some((o) => o.value === m.id));
  const renamed = [];
  const added = [];
  config.motifs = motifs.map((option) => {
    let motif = before.find((m) => m.id === option.value);
    if (!motif) {
      motif = { id: option.value, categoryId: null, welcome: null, roleIds: [] };
      added.push(motif);
    } else if (motif.label !== option.label) renamed.push(motif);
    motif.label = option.label;
    motif.description = option.description ?? null;
    motif.emoji = emojiText(option.emoji) || null;
    return motif;
  });
  setTicketConfig(guild.id, config, TICKET_KEY[slot]);

  const summary = [];
  for (const motif of renamed) await syncMotifCategoryName(guild, motif);
  if (renamed.length) summary.push('catégories renommées');
  if (added.length) {
    // Une catégorie par nouveau motif (comme /configticket).
    const created = await createCategories(guild, config).then(() => true).catch(() => false);
    setTicketConfig(guild.id, config, TICKET_KEY[slot]);
    summary.push(
      `${added.length} motif${added.length > 1 ? 's' : ''} ajouté${added.length > 1 ? 's' : ''}` +
        (created ? '' : ' — catégorie non créée, il me faut la permission « Gérer les salons »'),
    );
  }
  if (removed.length) {
    // La catégorie d'un motif supprimé part avec lui si elle est vide (sinon ses tickets ouverts restent).
    let kept = 0;
    for (const motif of removed) {
      const category = motif.categoryId && guild.channels.cache.get(motif.categoryId);
      if (!category) continue;
      const empty = !guild.channels.cache.some((c) => c.parentId === category.id);
      if (!empty || !(await category.delete('Motif supprimé avec /modifierembed').then(() => true).catch(() => false))) kept += 1;
    }
    summary.push(
      `${removed.length} motif${removed.length > 1 ? 's' : ''} supprimé${removed.length > 1 ? 's' : ''}` +
        (kept ? ` — ${kept} catégorie${kept > 1 ? 's' : ''} gardée${kept > 1 ? 's' : ''} car ${kept > 1 ? 'elles contiennent' : 'elle contient'} encore des tickets` : ''),
    );
  }
  return { config, summary: summary.join(', ') };
}

// 📨 Renvoyer : l'aperçu part en nouveau message dans le salon d'origine (le panneau de
// tickets dans son salon), l'ancien message n'est pas touché. Renvoie la note et la
// nouvelle cible (le message envoyé), lève une Error si impossible.
async function resendTarget(interaction, embed, { target, rr, motifs }) {
  const { guild } = interaction;
  const [type, a] = target.split('.');

  if (type === 'm') {
    const channel = await writableChannel(interaction, a);
    const rendered = await renderEmbedFor(guild, interaction.user, embed);
    if (rendered.timestamp) rendered.timestamp = new Date().toISOString();
    const sent = await channel.send({ embeds: [rendered], components: roleReactRows(rr, 'live') }).catch((err) => {
      throw new Error(`Impossible d’envoyer l’embed dans ${channel} : ${err.message}`);
    });
    trackSentEmbed(sent, embed);
    return {
      note: `✅ Embed renvoyé : ${sent.url}\n-# L’ancien message n’a pas été touché : supprime-le si tu n’en veux plus. 💾 modifie maintenant le nouveau.`,
      target: `m.${channel.id}.${sent.id}`,
    };
  }

  requireAdmin(interaction);
  const slot = Number(a);
  const { config, summary } = await applyTicketPanel(guild, slot, embed, motifs);
  const channel = await writableChannel(interaction, config.panelChannelId);
  const sent = await channel.send(buildTicketPanel(config, slot)).catch((err) => {
    throw new Error(`Impossible d’envoyer le panneau dans ${channel} : ${err.message}`);
  });
  rememberTicketPanel(guild, config, slot, sent);
  return {
    note:
      `✅ Panneau renvoyé : ${sent.url}${summary ? ` (${summary})` : ''}\n` +
      '-# L’ancien panneau marche encore : supprime-le si tu n’en veux qu’un. 💾 modifie maintenant le nouveau.',
    target,
  };
}

// Formulaire d'un motif du panneau : modification (titre vide = suppression), ou ajout si motif est null.
function motifModal(motif) {
  const text = (id, required, max, value) => {
    const input = new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(max);
    if (value) input.setValue(value.slice(0, max));
    return input;
  };
  const title = new LabelBuilder().setTextInputComponent(text('label', !motif, 80, motif?.label));
  if (motif) title.setLabel('Titre').setDescription('Vide = supprimer ce motif du panneau');
  else title.setLabel('Titre');
  return new ModalBuilder()
    .setCustomId(`emb_tmotifmodal:${motif?.value ?? 'new'}`)
    .setTitle(motif ? `Motif — ${motif.label}`.slice(0, 45) : 'Nouveau motif')
    .addLabelComponents(
      new LabelBuilder().setLabel('Emoji (optionnel)').setDescription(EMOJI_HELP).setTextInputComponent(text('emoji', false, 100, emojiText(motif?.emoji))),
      title,
      new LabelBuilder().setLabel('Description (optionnel)').setTextInputComponent(text('description', false, 90, motif?.description)),
    );
}

// Motifs de l'aperçu après le formulaire : ajouté ("new"), modifié, ou supprimé (titre vide).
// Renvoie { motifs, note }.
function applyMotifModal(interaction, motifId, motifs) {
  const get = (k) => interaction.fields.getTextInputValue(k)?.trim() ?? '';
  const index = motifId === 'new' ? -1 : motifs.findIndex((m) => m.value === motifId);
  if (motifId !== 'new' && index < 0) throw new Error('Motif introuvable dans l’aperçu.');

  if (!get('label')) {
    if (motifs.length <= 1) throw new Error('Le panneau doit garder au moins un motif.');
    return { motifs: motifs.filter((_, i) => i !== index), note: `🗑️ Motif **${motifs[index].label}** retiré de l’aperçu` };
  }
  if (index < 0 && motifs.length >= MAX_OPTIONS) throw new Error(`${MAX_OPTIONS} motifs maximum dans le panneau.`);
  // Nouveau motif : id unique (les motifs de /configticket sont m0, m1…).
  const option = { label: get('label'), value: index < 0 ? `m${Date.now().toString(36)}` : motifId };
  if (get('description')) option.description = get('description');
  if (get('emoji')) option.emoji = emojiFromInput(interaction, get('emoji'));
  return {
    motifs: upsert(motifs, index, option),
    note: index < 0 ? `➕ Motif **${option.label}** ajouté à l’aperçu` : `✏️ Motif **${option.label}** modifié dans l’aperçu`,
  };
}

const errorReply = (interaction, text) => interaction.reply({ content: `❌ ${text}`, ephemeral: true }).catch(() => {});

// Routeur des interactions du créateur d'embed (préfixe "emb_").
export async function handleEmbedBuilderInteraction(interaction) {
  const [action, arg] = (interaction.customId ?? '').split(':');

  // --- Role-react d'un embed envoyé : donne le rôle, ou le retire si le membre l'a déjà ---
  if (interaction.isButton() && action === 'emb_role') {
    const content = await toggleRole(interaction, arg);
    return interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } });
  }

  if (interaction.isStringSelectMenu() && action === 'emb_rsel') {
    // Remet le sélecteur à zéro : rechoisir la même option retire le rôle.
    await interaction.update({ components: interaction.message.components });
    const content = await toggleRole(interaction, interaction.values[0]);
    return interaction.followUp({ content, ephemeral: true, allowedMentions: { parse: [] } });
  }

  const state = currentState(interaction);
  const { role, rr } = state;

  // --- Role-react : formulaire → bouton ou option ajouté à l'aperçu ---
  if (interaction.isButton() && (action === 'emb_rr' || action === 'emb_rs')) {
    return interaction.showModal(roleReactModal(ROLE_REACT_KIND[action]));
  }

  if (interaction.isModalSubmit() && (action === 'emb_rrmodal' || action === 'emb_rsmodal')) {
    const kind = ROLE_REACT_KIND[action];
    let next;
    try {
      next = applyRoleReactModal(interaction, kind, rr);
    } catch (err) {
      return errorReply(interaction, err.message);
    }
    const note = kind === 'button' ? '✅ Bouton de rôle enregistré.' : '✅ Option du sélecteur enregistrée.';
    return interaction
      .update(builderPayload(currentEmbed(interaction), note, { ...state, rr: next }))
      .catch((err) => errorReply(interaction, `Discord a refusé le role-react (emoji invalide ?) : ${err.message}`));
  }

  if (interaction.isButton() && action === 'emb_rrdel') {
    const next = { ...rr, buttons: rr.buttons.filter((b) => b.roleId !== arg) };
    return interaction.update(builderPayload(currentEmbed(interaction), '🗑️ Bouton de rôle retiré.', { ...state, rr: next }));
  }

  if (interaction.isStringSelectMenu() && action === 'emb_rsdel') {
    const next = { ...rr, options: rr.options.filter((o) => o.value !== interaction.values[0]) };
    return interaction.update(builderPayload(currentEmbed(interaction), '🗑️ Option du sélecteur retirée.', { ...state, rr: next }));
  }

  // --- /modifierembed : motif du panneau de tickets → formulaire pré-rempli ---
  if (interaction.isStringSelectMenu() && action === 'emb_tmotif') {
    const motif = state.motifs.find((m) => m.value === interaction.values[0]);
    if (!motif) return errorReply(interaction, 'Motif introuvable dans l’aperçu.');
    return interaction.showModal(motifModal(motif));
  }

  if (interaction.isButton() && action === 'emb_tmotifadd') {
    if (state.motifs.length >= MAX_OPTIONS) return errorReply(interaction, `${MAX_OPTIONS} motifs maximum dans le panneau.`);
    return interaction.showModal(motifModal(null));
  }

  if (interaction.isModalSubmit() && action === 'emb_tmotifmodal') {
    let result;
    try {
      result = applyMotifModal(interaction, arg, state.motifs);
    } catch (err) {
      return errorReply(interaction, err.message);
    }
    return interaction
      .update(builderPayload(currentEmbed(interaction), `${result.note} : clique sur 💾 pour l’enregistrer.`, { ...state, motifs: result.motifs }))
      .catch((err) => errorReply(interaction, `Discord a refusé le motif (emoji invalide ?) : ${err.message}`));
  }

  // --- /modifierembed : l'aperçu part en nouveau message (l'ancien reste) ---
  if (interaction.isButton() && action === 'emb_resend' && state.target) {
    const embed = currentEmbed(interaction);
    await interaction.deferUpdate();
    let result;
    try {
      result = await resendTarget(interaction, embed, state);
    } catch (err) {
      return interaction.followUp({ content: `❌ ${err.message}`, ephemeral: true }).catch(() => {});
    }
    return interaction.editReply(builderPayload(embed, result.note, { ...state, target: result.target }));
  }

  // --- /modifierembed : l'aperçu remplace l'embed d'origine ---
  if (interaction.isButton() && action === 'emb_save' && state.target) {
    const embed = currentEmbed(interaction);
    // Renommer les catégories des motifs peut attendre la limite de Discord : on répond tout de suite.
    await interaction.deferUpdate();
    let note;
    try {
      note = await saveTarget(interaction, embed, state);
    } catch (err) {
      return interaction.followUp({ content: `❌ ${err.message}`, ephemeral: true }).catch(() => {});
    }
    return interaction.editReply(builderPayload(embed, note, state));
  }

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
    return interaction.update(builderPayload(embed, '', state)).catch((err) => errorReply(interaction, `Discord a refusé l’embed : ${err.message}`));
  }

  // --- Partenariat : formulaire (rôle, titre, description, images) → aperçu ---
  if (interaction.isButton() && action === 'emb_partner') {
    if (hasRoleReact(rr)) {
      return errorReply(interaction, 'Le mode partenariat n’a pas de role-react : retire d’abord les boutons et le sélecteur de l’aperçu.');
    }
    const base = partnerBase(interaction, role);
    return interaction.showModal(partnerModal(base.embed, base.roleId));
  }

  if (interaction.isModalSubmit() && action === 'emb_partnermodal') {
    let result;
    try {
      result = applyPartnerModal(interaction, partnerBase(interaction, role).embed);
    } catch (err) {
      return errorReply(interaction, err.message);
    }
    const { channelId } = getPartner(interaction.guild.id);
    const hint = channelId
      ? `📌 Envoi automatique actif dans <#${channelId}>. Choisis le salon partenariat ci-dessous pour y enregistrer cette version de l’embed.`
      : '📌 Choisis le **salon partenariat** ci-dessous : l’embed y sera envoyé après chaque message.';
    return interaction
      .update(builderPayload(result.embed, [result.note, hint].filter(Boolean).join('\n'), { ...state, role: result.roleId }))
      .catch((err) => errorReply(interaction, `Discord a refusé l’embed : ${err.message}`));
  }

  // --- Salon partenariat : l'embed actuel y est envoyé après chaque message ---
  if ((action === 'emb_partnerchan' || action === 'emb_partneroff') && role) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return errorReply(interaction, 'Il faut être administrateur pour régler le salon partenariat.');
    }
    const embed = currentEmbed(interaction);
    if (interaction.isButton() && action === 'emb_partneroff') {
      patchPartner(interaction.guild.id, { channelId: null, embed: null });
      return interaction.update(
        builderPayload(embed, '🗑️ Envoi automatique désactivé.\n-# Le nombre de partenariats (`[nump]`, `/nump`) est conservé.', state),
      );
    }
    if (interaction.isChannelSelectMenu()) {
      const channelId = interaction.values[0];
      patchPartner(interaction.guild.id, { channelId, roleId: role, embed });
      const me = interaction.guild.members.me;
      const canSend = interaction.guild.channels.cache
        .get(channelId)
        ?.permissionsFor(me)
        ?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks]);
      return interaction.update(
        builderPayload(
          embed,
          `✅ **Salon partenariat : <#${channelId}>** — après chaque message posté, j’envoie cet embed avec la mention du rôle et je compte un partenariat pour son auteur.\n` +
            (canSend ? '' : '⚠️ Je n’ai pas la permission d’envoyer des embeds dans ce salon : vérifie mes permissions.\n') +
            '-# Si tu modifies l’embed, resélectionne le salon pour enregistrer la nouvelle version.',
          state,
        ),
      );
    }
  }

  // --- Envoyer l'embed dans le salon ---
  if (interaction.isButton() && action === 'emb_send') {
    const embed = currentEmbed(interaction);
    const sent = await interaction.channel.send(await outgoing(interaction, embed, role, rr)).catch(() => null);
    if (sent) trackSentEmbed(sent, embed);
    if (!sent) return errorReply(interaction, 'Impossible d’envoyer l’embed ici (permissions ?).');
    return interaction.update(builderPayload(embed, '✅ Embed envoyé dans ce salon.', state));
  }

  // --- Choisir le salon d'envoi → menu, l'aperçu reste affiché ---
  if (interaction.isButton() && action === 'emb_pick') {
    return interaction.update({
      content: withRole('📁 Dans quel salon envoyer l’embed ?', role),
      embeds: [currentEmbed(interaction)],
      allowedMentions: { parse: [] },
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
        ...roleReactRows(rr, 'disabled'),
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
    const sent = await channel.send(await outgoing(interaction, embed, role, rr)).catch(() => null);
    if (sent) trackSentEmbed(sent, embed);
    if (!sent) return errorReply(interaction, `Impossible d’envoyer l’embed dans ${channel} (permissions ?).`);
    return interaction.update(builderPayload(embed, `✅ Embed envoyé dans ${channel}.`, state));
  }

  // --- Embed de bienvenue / départ (séparé du message texte) ---
  if (action.startsWith('emb_greet') && GREET_LABEL[arg]) {
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
      return errorReply(interaction, 'Il faut être administrateur pour changer l’embed de bienvenue / départ.');
    }
    const guildId = interaction.guild.id;
    const embed = currentEmbed(interaction);
    const current = getGreetEmbed(guildId, arg);
    const currentChannel = current?.channelId && (await interaction.guild.channels.fetch(current.channelId).catch(() => null));

    // Écran de choix : nouveau salon, garder l'actuel, ou désactiver.
    if (interaction.isButton() && action === 'emb_greet') {
      const buttons = [];
      if (currentChannel) {
        buttons.push(new ButtonBuilder().setCustomId(`emb_greetkeep:${arg}`).setLabel('Garder le salon actuel').setStyle(ButtonStyle.Success));
      }
      if (current) {
        buttons.push(new ButtonBuilder().setCustomId(`emb_greetoff:${arg}`).setLabel(`Désactiver l’embed de ${GREET_LABEL[arg]}`).setStyle(ButtonStyle.Danger));
      }
      buttons.push(new ButtonBuilder().setCustomId('emb_back').setLabel('Retour').setStyle(ButtonStyle.Secondary));
      return interaction.update({
        content: withRole(
          `📁 Dans quel salon envoyer l’**embed de ${GREET_LABEL[arg]}** ?` +
            (currentChannel ? ` (actuel : ${currentChannel})` : '') +
            `\n-# Indépendant du message texte de ${GREET_CMD[arg]} : les deux sont envoyés séparément.`,
          role,
        ),
        embeds: [embed],
        allowedMentions: { parse: [] },
        components: [
          new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder()
              .setCustomId(`emb_greetchan:${arg}`)
              .setPlaceholder('Choisis un salon')
              .addChannelTypes(ChannelType.GuildText),
          ),
          new ActionRowBuilder().addComponents(...buttons),
          // Gardés (inactifs) pour les retrouver au retour dans l'aperçu.
          ...roleReactRows(rr, 'disabled'),
        ],
      });
    }

    if (interaction.isChannelSelectMenu() && action === 'emb_greetchan') {
      return interaction.update(builderPayload(embed, saveGreeting(guildId, arg, interaction.values[0], embed), state));
    }

    if (interaction.isButton() && action === 'emb_greetkeep') {
      if (!currentChannel) return errorReply(interaction, 'Le salon actuel n’existe plus, choisis-en un autre.');
      return interaction.update(builderPayload(embed, saveGreeting(guildId, arg, currentChannel.id, embed), state));
    }

    if (interaction.isButton() && action === 'emb_greetoff') {
      setGreetEmbed(guildId, arg, null);
      return interaction.update(
        builderPayload(embed, `🗑️ Embed de ${GREET_LABEL[arg]} désactivé.\n-# Le message texte de ${GREET_CMD[arg]} n’est pas touché.`, state),
      );
    }
  }

  if (interaction.isButton() && action === 'emb_back') {
    return interaction.update(builderPayload(currentEmbed(interaction), '', state));
  }
}
