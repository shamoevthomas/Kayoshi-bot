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
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} from 'discord.js';
import { getGreetEmbed, setGreetEmbed, getPartner, patchPartner } from './store.js';
import { TEMPLATE_HELP, renderEmbedFor } from './greetings.js';

// Créateur d'embed (/embed) : aperçu éphémère + boutons d'édition.
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

function builderRows(roleId) {
  const edit = (section, label) =>
    new ButtonBuilder().setCustomId(`emb_edit:${section}`).setLabel(label).setStyle(ButtonStyle.Secondary);
  // Mode partenariat : salon où l'embed est envoyé après chaque message.
  const partnerRows = roleId
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
    : [];
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
      new ButtonBuilder().setCustomId('emb_partner').setLabel('Partenariat').setStyle(ButtonStyle.Primary).setEmoji('🤝'),
      new ButtonBuilder().setCustomId('emb_send').setLabel('Envoyer dans ce salon').setStyle(ButtonStyle.Success).setEmoji('📨'),
      new ButtonBuilder().setCustomId('emb_pick').setLabel('Choisir un salon').setStyle(ButtonStyle.Success).setEmoji('📁'),
    ),
    ...partnerRows,
  ];
}

// Ligne qui garde le rôle à mentionner dans le texte de l'aperçu (mode partenariat).
function withRole(text, roleId) {
  return roleId ? `${text}\n\n🤝 **Partenariat** — <@&${roleId}> sera mentionné au-dessus de l’embed à l’envoi.` : text;
}

function currentRole(interaction) {
  return interaction.message?.content?.match(/<@&(\d+)>/)?.[1] ?? null;
}

export function builderPayload(embed, note = '', roleId = null) {
  return {
    content: `${withRole(INTRO, roleId)}${note ? `\n\n${note}` : ''}`,
    embeds: [embed],
    components: builderRows(roleId),
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

// Auteur = membre qui crée l'embed, pied de page = serveur, avec l'heure.
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
  e.footer ??= { text: `Partenariat avec ${guild.name}`, icon_url: guild.iconURL() ?? undefined };
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

// Message envoyé : templates remplacés, heure d'envoi, et mention du rôle en mode partenariat.
async function outgoing(interaction, embed, roleId) {
  const rendered = await renderEmbedFor(interaction.guild, interaction.user, embed);
  if (rendered.timestamp) rendered.timestamp = new Date().toISOString();
  if (!roleId) return { embeds: [rendered] };
  return { content: `<@&${roleId}>`, embeds: [rendered], allowedMentions: { roles: [roleId] } };
}

// L'embed est stocké à part : le message texte de /bienvenue ou /quitte n'est pas touché.
function saveGreeting(guildId, type, channelId, embed) {
  setGreetEmbed(guildId, type, { channelId, embed });
  return `✅ Cet embed est maintenant l’**embed de ${GREET_LABEL[type]}**, envoyé dans <#${channelId}>.\n-# Le message texte de ${GREET_CMD[type]} reste inchangé et est envoyé à part.`;
}

const errorReply = (interaction, text) => interaction.reply({ content: `❌ ${text}`, ephemeral: true }).catch(() => {});

// Routeur des interactions du créateur d'embed (préfixe "emb_").
export async function handleEmbedBuilderInteraction(interaction) {
  const [action, arg] = (interaction.customId ?? '').split(':');
  const role = currentRole(interaction);

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
    return interaction.update(builderPayload(embed, '', role)).catch((err) => errorReply(interaction, `Discord a refusé l’embed : ${err.message}`));
  }

  // --- Partenariat : formulaire (rôle, titre, description, images) → aperçu ---
  if (interaction.isButton() && action === 'emb_partner') {
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
      .update(builderPayload(result.embed, [result.note, hint].filter(Boolean).join('\n'), result.roleId))
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
        builderPayload(embed, '🗑️ Envoi automatique désactivé.\n-# Le nombre de partenariats (`[nump]`, `/nump`) est conservé.', role),
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
          role,
        ),
      );
    }
  }

  // --- Envoyer l'embed dans le salon ---
  if (interaction.isButton() && action === 'emb_send') {
    const embed = currentEmbed(interaction);
    const sent = await interaction.channel.send(await outgoing(interaction, embed, role)).then(() => true).catch(() => false);
    if (!sent) return errorReply(interaction, 'Impossible d’envoyer l’embed ici (permissions ?).');
    return interaction.update(builderPayload(embed, '✅ Embed envoyé dans ce salon.', role));
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
    const sent = await channel.send(await outgoing(interaction, embed, role)).then(() => true).catch(() => false);
    if (!sent) return errorReply(interaction, `Impossible d’envoyer l’embed dans ${channel} (permissions ?).`);
    return interaction.update(builderPayload(embed, `✅ Embed envoyé dans ${channel}.`, role));
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
        ],
      });
    }

    if (interaction.isChannelSelectMenu() && action === 'emb_greetchan') {
      return interaction.update(builderPayload(embed, saveGreeting(guildId, arg, interaction.values[0], embed), role));
    }

    if (interaction.isButton() && action === 'emb_greetkeep') {
      if (!currentChannel) return errorReply(interaction, 'Le salon actuel n’existe plus, choisis-en un autre.');
      return interaction.update(builderPayload(embed, saveGreeting(guildId, arg, currentChannel.id, embed), role));
    }

    if (interaction.isButton() && action === 'emb_greetoff') {
      setGreetEmbed(guildId, arg, null);
      return interaction.update(
        builderPayload(embed, `🗑️ Embed de ${GREET_LABEL[arg]} désactivé.\n-# Le message texte de ${GREET_CMD[arg]} n’est pas touché.`, role),
      );
    }
  }

  if (interaction.isButton() && action === 'emb_back') {
    return interaction.update(builderPayload(currentEmbed(interaction), '', role));
  }
}
