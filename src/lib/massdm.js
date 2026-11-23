import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  REST,
  RoleSelectMenuBuilder,
  Routes,
  SectionBuilder,
  SeparatorBuilder,
  StringSelectMenuBuilder,
  TextDisplayBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { botMentionRe } from './quote.js';
import { getGuildConfig, setGuildConfig } from './store.js';
import { isOwnerLike } from './coowners.js';

// « @Kayoshi cmd » (propriétaire du serveur, et membres qu'il autorise) : DM de masse aux membres du serveur. Un panneau
// (Components V2) règle le token du bot qui envoie (obligatoire au-delà de 5 membres : Kayoshi n'envoie jamais de DM
// de masse lui-même, pour ne pas risquer d'être banni ; jusqu'à 5, sans token, c'est lui qui envoie), le message
// et/ou un embed, la cible
// (un rôle, des IDs, ou les membres en ligne / absents / ne pas déranger / hors ligne) et des IDs à ignorer. « DMall »
// demande confirmation, puis envoie un DM toutes les 1,5 à 2 s : les MP fermés (erreur 50007) sont comptés
// sans arrêter l'envoi, l'avancement s'affiche sur le panneau et un récapitulatif est envoyé à la fin.
// Le token se tape dans un formulaire (dans le salon, les logs et +snipe le recopieraient) et n'est jamais
// enregistré : il reste en mémoire le temps de la configuration et de l'envoi.

const PAUSE_MIN_MS = 1500;
const PAUSE_MAX_MS = 2000;
const SESSION_MS = 30 * 60_000; // panneau abandonné au bout de 30 min sans action
const MAX_ERRORS_IN_A_ROW = 10; // le bot n'arrive plus à envoyer (bloqué par Discord…) : arrêt
const MAX_WITHOUT_TOKEN = 5; // sans token, Kayoshi envoie lui-même, jusqu'à ce nombre de membres
const COLOR = 0x5865f2;
const STATUSES = { online: '🟢 En ligne', idle: '🌙 Absent', dnd: '⛔ Ne pas déranger', offline: '⚫ Hors ligne' };
const ID_RE = /\d{17,20}/g;
// Qui peut utiliser le DMall sur un serveur : son propriétaire, les membres qu'il y a autorisés lui-même
// (« @Kayoshi cmd @membre », data[guildId].dmlAllowed), et sur les serveurs de laysox_off (Hanami,
// Ichima…) crown2ito, l0un4tik et le rôle Crown de Hanami.
const DELEGATING_OWNER_ID = '1079335251551191061'; // laysox_off
const DELEGATES = ['1543615549974515763', '1260266494839754866']; // crown2ito, l0un4tik
export const CROWN_ROLE_ID = '1566530617150021873'; // Crown (Hanami)
const allowedIds = (guildId) => getGuildConfig(guildId).dmlAllowed ?? [];
const canUse = (guild, userId, member) =>
  userId === guild.ownerId ||
  allowedIds(guild.id).includes(userId) ||
  (guild.ownerId === DELEGATING_OWNER_ID && (DELEGATES.includes(userId) || Boolean(member?.roles?.cache?.has(CROWN_ROLE_ID))));

const sessions = new Map(); // guildId → { panel, rest, botName, content, embed, target, ignore, count, pending, at }
const runs = new Map(); // guildId → { stopped }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ids = (text) => [...new Set(text.match(ID_RE) ?? [])];
// Aperçu dans un bloc de code : sans ``` qui le fermerait, coupé à `max` caractères.
const preview = (text, max = 300) => {
  const clean = text.replace(/`/g, 'ˋ');
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
};
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const button = (id, label, style) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);

// --- Commande « @Kayoshi cmd » ---

const normalize = (word) => (word ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const TEXT_NAME = /^@?kayo(?:shi)?\b/i;

// Mots qui suivent « @Kayoshi » : la vraie mention du bot (utilisateur ou rôle), ou « kayoshi » / « @kayoshi » /
// « kayo » écrit en texte au début du message (une mention tapée sans la choisir dans la liste de Discord reste du
// texte). null si le message ne s'adresse pas au bot.
function commandWords(message) {
  const content = message.content.trim();
  let text;
  if (botMentionRe(message).test(content)) text = content.replace(botMentionRe(message), ' ');
  else if (TEXT_NAME.test(content)) text = content.replace(TEXT_NAME, ' ');
  else return null;
  return text.trim().split(/\s+/).filter(Boolean);
}

export async function handleMassDmCommand(message) {
  if (!message.guild || message.author.bot) return false;
  const words = commandWords(message);
  if (!words) return false;
  // « cmd » est facultatif devant autoriser / retirer / autorisés : « @Kayoshi autorisés » marche aussi.
  const hasCmd = normalize(words[0]) === 'cmd';
  const rest = hasCmd ? words.slice(1) : words;
  const sub = normalize(rest[0]);
  if (/^(autoris|retir|liste$)/.test(sub)) {
    await handleAccessCommand(message, sub, rest.slice(1).join(' '));
    return true;
  }
  // « @Kayoshi cmd @membre » (ou son ID) : donner l'accès à ce membre.
  if (hasCmd && /^(<@!?\d{17,20}>|\d{17,20})$/.test(rest[0] ?? '')) {
    await handleAccessCommand(message, 'autoriser', rest.join(' '));
    return true;
  }
  if (!hasCmd || sub) return false;
  if (!canUse(message.guild, message.author.id, message.member)) {
    await message
      .reply({ content: '❌ vous n’avez pas le droit d’utiliser `@Kayoshi cmd`.', allowedMentions: { parse: [], repliedUser: false } })
      .catch(() => {});
    return true;
  }

  if (runs.has(message.guild.id)) {
    await message.reply({ content: '⏳ Un DMall est déjà en cours sur ce serveur.', allowedMentions: { repliedUser: false } }).catch(() => {});
    return true;
  }
  const session = { rest: null, botName: null, content: '', embed: null, target: null, ignore: [], count: 0, at: Date.now() };
  session.panel = await message.reply({ ...panelPayload(session), allowedMentions: { parse: [] } }).catch(() => null);
  if (session.panel) sessions.set(message.guild.id, session);
  return true;
}

// « @Kayoshi cmd @membre… » / « retirer @membre… » / « autorisés » : le propriétaire du serveur et ses
// co-propriétaires (50.nn et l0un4tik sur les serveurs de laysox_off, lib/coowners.js) donnent ou reprennent le droit
// d'utiliser le DMall sur le serveur (le membre autorisé envoie avec le token de son bot).
async function handleAccessCommand(message, sub, text) {
  const { guild } = message;
  const reply = (content) => message.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
  if (!isOwnerLike(guild, message.author.id)) {
    return reply('❌ Seuls le propriétaire du serveur et ses co-propriétaires peuvent donner ou retirer le droit d’utiliser `@Kayoshi cmd`.');
  }
  const current = allowedIds(guild.id);
  const targets = ids(text).filter((id) => id !== guild.ownerId && id !== message.client.user.id);
  const revoke = sub.startsWith('retir');
  // « autorisés », « liste », ou « autoriser » sans membre : la liste.
  if (!revoke && !targets.length) {
    return reply(
      current.length
        ? `👥 Autorisés à utiliser \`@Kayoshi cmd\` ici : ${current.map((id) => `<@${id}>`).join(', ')}\n-# Ajouter : \`@Kayoshi cmd @membre\` · retirer : \`@Kayoshi cmd retirer @membre\``
        : 'ℹ️ Aucun membre autorisé ici pour l’instant. Pour autoriser un membre : `@Kayoshi cmd @membre`.',
    );
  }
  if (!targets.length) return reply('❌ Mentionne le ou les membres (ou leurs IDs) : `@Kayoshi cmd retirer @membre`.');
  const allowed = revoke ? current.filter((id) => !targets.includes(id)) : [...new Set([...current, ...targets])];
  setGuildConfig(guild.id, { dmlAllowed: allowed });
  const who = targets.map((id) => `<@${id}>`).join(', ');
  return reply(
    !revoke
      ? `✅ ${who} peut maintenant vous aider sur ce serveur.`
      : `✅ ${who} ne peut plus utiliser \`@Kayoshi cmd\` sur ce serveur.`,
  );
}

// --- Panneau ---

function panelPayload(session) {
  const container = new ContainerBuilder().setAccentColor(COLOR);
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('## 📨 Configuration du DMall\n-# Utilise les boutons ci-dessous pour configurer ton DM de masse.'),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(
          `**🤖 Token**\n${session.botName ? `Bot : **${session.botName}**` : `*Aucun token ajouté : Kayoshi envoie lui-même jusqu’à ${MAX_WITHOUT_TOKEN} membres, au-delà le token est obligatoire*`}`,
        ),
      )
      .setButtonAccessory(button('dml_token', '➕ Définir le token', ButtonStyle.Primary)),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  const embed = session.embed;
  const embedText = embed ? [embed.title, embed.description].filter(Boolean).join(' — ') || '(image seule)' : '';
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**📩 Message**\n\`\`\`\n${session.content ? preview(session.content) : 'Aucun message défini'}\n\`\`\``),
        new TextDisplayBuilder().setContent(`**📝 Embed**\n\`\`\`\n${embed ? preview(embedText) : 'Aucun embed défini'}\n\`\`\``),
      )
      .setButtonAccessory(button('dml_message', '📝 Définir le message', ButtonStyle.Success)),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addSectionComponents(
    new SectionBuilder()
      .addTextDisplayComponents(
        new TextDisplayBuilder().setContent(`**👥 Cible** — ${targetText(session)}`),
        new TextDisplayBuilder().setContent(`**🚫 IDs à ignorer** — Total : ${plural(session.ignore.length, 'ID')}`),
      )
      .setButtonAccessory(button('dml_options', '⚙️ Options de DM', ButtonStyle.Secondary)),
  );
  container.addSeparatorComponents(new SeparatorBuilder());
  container.addActionRowComponents(
    new ActionRowBuilder().addComponents(
      button('dml_status', '⭐ Définir le status', ButtonStyle.Primary),
      button('dml_go', '🚀 DMall', ButtonStyle.Danger),
    ),
  );
  container.addTextDisplayComponents(
    new TextDisplayBuilder().setContent('-# Kayoshi · réservé au propriétaire du serveur et aux membres autorisés · un DM toutes les 1,5 à 2 s'),
  );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function targetText({ target, count }) {
  const total = `Total : **${plural(count, 'membre')}**`;
  if (target?.type === 'role') return `Rôle <@&${target.roleId}> · ${total}`;
  if (target?.type === 'status') return `${target.statuses.map((s) => STATUSES[s]).join(' · ')} · ${total} en ce moment`;
  if (target?.type === 'ids') return `IDs · ${total} (sur ${plural(target.ids.length, 'ID')})`;
  return '*Aucune cible : un rôle ou des IDs (⚙️ Options de DM), ou des statuts (⭐ Définir le status)*';
}

// --- Formulaires ---

function tokenModal() {
  return new ModalBuilder()
    .setCustomId('dml_token_modal')
    .setTitle('Token du bot')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Token du bot qui envoie les DM')
        .setDescription(`Obligatoire au-delà de ${MAX_WITHOUT_TOKEN} membres. Le bot doit être sur ce serveur.`)
        .setTextInputComponent(new TextInputBuilder().setCustomId('token').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200)),
    );
}

function text(id, style, max, value, placeholder) {
  const input = new TextInputBuilder().setCustomId(id).setStyle(style).setRequired(false).setMaxLength(max);
  if (value) input.setValue(value);
  if (placeholder) input.setPlaceholder(placeholder);
  return input;
}

function messageModal({ content, embed }) {
  const color = embed?.color != null ? `#${embed.color.toString(16).padStart(6, '0')}` : '';
  return new ModalBuilder()
    .setCustomId('dml_message_modal')
    .setTitle('Message du DM')
    .addLabelComponents(
      new LabelBuilder().setLabel('Message').setTextInputComponent(text('content', TextInputStyle.Paragraph, 2000, content)),
      new LabelBuilder().setLabel('Titre de l’embed').setTextInputComponent(text('title', TextInputStyle.Short, 256, embed?.title)),
      new LabelBuilder()
        .setLabel('Description de l’embed')
        .setTextInputComponent(text('description', TextInputStyle.Paragraph, 4000, embed?.description)),
      new LabelBuilder().setLabel('Couleur de l’embed').setTextInputComponent(text('color', TextInputStyle.Short, 7, color, '#5865f2')),
      new LabelBuilder()
        .setLabel('Image de l’embed (lien)')
        .setTextInputComponent(text('image', TextInputStyle.Short, 500, embed?.image?.url, 'https://…')),
    );
}

function optionsModal({ target, ignore }) {
  const role = new RoleSelectMenuBuilder().setCustomId('role').setRequired(false).setMinValues(0).setMaxValues(1);
  if (target?.type === 'role') role.setDefaultRoles(target.roleId);
  return new ModalBuilder()
    .setCustomId('dml_options_modal')
    .setTitle('Options de DM')
    .addLabelComponents(
      new LabelBuilder().setLabel('Par rôle').setDescription('Tous les membres qui ont ce rôle').setRoleSelectMenuComponent(role),
      new LabelBuilder()
        .setLabel('Ou par IDs de membres')
        .setDescription('Séparés par des espaces, des virgules ou des retours à la ligne')
        .setTextInputComponent(text('ids', TextInputStyle.Paragraph, 4000, target?.type === 'ids' ? target.ids.join(' ') : '')),
      new LabelBuilder()
        .setLabel('IDs à ignorer')
        .setDescription('Ces membres ne recevront pas le DM')
        .setTextInputComponent(text('ignore', TextInputStyle.Paragraph, 4000, ignore.join(' '))),
    );
}

function statusModal({ target }) {
  const current = target?.type === 'status' ? target.statuses : [];
  const select = new StringSelectMenuBuilder()
    .setCustomId('statuses')
    .setMinValues(1)
    .setMaxValues(Object.keys(STATUSES).length)
    .addOptions(Object.entries(STATUSES).map(([value, label]) => ({ value, label, default: current.includes(value) })));
  return new ModalBuilder()
    .setCustomId('dml_status_modal')
    .setTitle('Cible par statut')
    .addLabelComponents(
      new LabelBuilder().setLabel('Statuts').setDescription('Les membres avec ces statuts recevront le DM (hors ligne : aussi les invisibles)').setStringSelectMenuComponent(select),
    );
}

// --- Interactions « dml_… » (propriétaire du serveur et membres autorisés) ---

export async function handleMassDmInteraction(interaction) {
  const { guild, customId: action } = interaction;
  if (!canUse(guild, interaction.user.id, interaction.member)) {
    return interaction.reply({ content: '❌ Réservé au propriétaire du serveur et aux membres autorisés.', ephemeral: true });
  }
  if (action === 'dml_stop') {
    const run = runs.get(guild.id);
    if (!run) return interaction.reply({ content: 'ℹ️ Aucun DMall en cours.', ephemeral: true });
    run.stopped = true;
    return interaction.deferUpdate();
  }

  const session = sessions.get(guild.id);
  const expired = !session || Date.now() - session.at > SESSION_MS;
  // Boutons du panneau : seulement sur le dernier panneau ouvert (les boutons de confirmation sont éphémères).
  const onPanel = interaction.message && !interaction.message.flags.has(MessageFlags.Ephemeral);
  if (expired || (onPanel && interaction.message.id !== session.panel.id)) {
    if (expired) sessions.delete(guild.id);
    return interaction.reply({ content: '⌛ Ce panneau a expiré : relance `@Kayoshi cmd`.', ephemeral: true });
  }
  if (runs.has(guild.id)) return interaction.reply({ content: '⏳ Un DMall est déjà en cours.', ephemeral: true });
  session.at = Date.now();

  if (action === 'dml_token') return interaction.showModal(tokenModal());
  if (action === 'dml_message') return interaction.showModal(messageModal(session));
  if (action === 'dml_options') return interaction.showModal(optionsModal(session));
  if (action === 'dml_status') return interaction.showModal(statusModal(session));
  if (action === 'dml_token_modal') return submitToken(interaction, session);
  if (action === 'dml_message_modal') return submitMessage(interaction, session);
  if (action === 'dml_options_modal') return submitOptions(interaction, session);
  if (action === 'dml_status_modal') return submitStatus(interaction, session);
  if (action === 'dml_go') return confirmDmAll(interaction, session);
  if (action === 'dml_abort') {
    session.pending = null;
    return interaction.update({ content: '❌ DMall annulé.', components: [] });
  }
  if (action === 'dml_confirm') return startDmAll(interaction, session);
}

// Après un formulaire : panneau mis à jour, et l'éventuelle erreur en message éphémère.
async function refreshPanel(interaction, session, error) {
  await interaction.editReply({ ...panelPayload(session), allowedMentions: { parse: [] } });
  if (error) await interaction.followUp({ content: `❌ ${error}`, ephemeral: true });
}

async function submitToken(interaction, session) {
  await interaction.deferUpdate();
  const token = interaction.fields.getTextInputValue('token').trim().replace(/^Bot\s+/i, '');
  if (!token) return refreshPanel(interaction, session, 'Il faut le token d’un bot : Kayoshi n’envoie pas les DM de masse lui-même.');
  const rest = new REST({ hashSweepInterval: 0, handlerSweepInterval: 0 }).setToken(token);
  const me = await rest.get(Routes.user()).catch(() => null);
  if (!me?.bot) return refreshPanel(interaction, session, 'Token invalide : il faut le token d’un **bot** (Developer Portal → Bot → Reset Token).');
  const inGuild = await rest.get(Routes.guild(interaction.guild.id)).catch(() => null);
  if (!inGuild) {
    return refreshPanel(interaction, session, `**${me.username}** n’est pas sur ce serveur : invite-le d’abord (un bot ne peut écrire qu’aux membres d’un serveur où il est).`);
  }
  Object.assign(session, { rest, botName: me.username });
  return refreshPanel(interaction, session);
}

async function submitMessage(interaction, session) {
  await interaction.deferUpdate();
  const field = (id) => interaction.fields.getTextInputValue(id).trim();
  const [title, description, color, image] = ['title', 'description', 'color', 'image'].map(field);
  if (color && !/^#?[0-9a-f]{6}$/i.test(color)) return refreshPanel(interaction, session, 'Couleur invalide : écris-la comme `#5865f2`.');
  if (image && !/^https?:\/\/\S+$/i.test(image)) return refreshPanel(interaction, session, 'Image invalide : il faut un lien qui commence par `https://`.');
  session.content = interaction.fields.getTextInputValue('content');
  session.embed =
    title || description || image
      ? {
          ...(title ? { title } : {}),
          ...(description ? { description } : {}),
          ...(color ? { color: parseInt(color.replace('#', ''), 16) } : {}),
          ...(image ? { image: { url: image } } : {}),
        }
      : null;
  return refreshPanel(interaction, session);
}

async function submitOptions(interaction, session) {
  await interaction.deferUpdate();
  const roleId = interaction.fields.getSelectedRoles('role')?.first()?.id;
  const targetIds = ids(interaction.fields.getTextInputValue('ids'));
  if (roleId && targetIds.length) return refreshPanel(interaction, session, 'Choisis **un rôle ou des IDs**, pas les deux.');
  session.ignore = ids(interaction.fields.getTextInputValue('ignore'));
  if (roleId) session.target = { type: 'role', roleId };
  else if (targetIds.length) session.target = { type: 'ids', ids: targetIds };
  else if (session.target?.type !== 'status') session.target = null;
  session.count = session.target ? (await resolveTargets(interaction.guild, session)).length : 0;
  return refreshPanel(interaction, session);
}

async function submitStatus(interaction, session) {
  await interaction.deferUpdate();
  session.target = { type: 'status', statuses: interaction.fields.getStringSelectValues('statuses') };
  session.count = (await resolveTargets(interaction.guild, session)).length;
  return refreshPanel(interaction, session);
}

// Membres qui recevront le DM (IDs), sans les bots ni les IDs à ignorer.
async function resolveTargets(guild, { target, ignore }) {
  let members = [];
  if (target.type === 'ids') {
    for (let i = 0; i < target.ids.length; i += 100) {
      const part = await guild.members.fetch({ user: target.ids.slice(i, i + 100) }).catch(() => null);
      if (part) members.push(...part.values());
    }
  } else {
    const all = await guild.members.fetch({ withPresences: target.type === 'status' });
    members = [...all.values()].filter((m) =>
      target.type === 'role' ? m.roles.cache.has(target.roleId) : target.statuses.includes(m.presence?.status ?? 'offline'),
    );
  }
  const skip = new Set(ignore);
  return members.filter((m) => !m.user.bot && !skip.has(m.id)).map((m) => m.id);
}

// --- Envoi ---

async function confirmDmAll(interaction, session) {
  if (!session.content.trim() && !session.embed) {
    return interaction.reply({ content: '❌ Définis d’abord le message ou l’embed (📝 Définir le message).', ephemeral: true });
  }
  if (!session.target) return interaction.reply({ content: '❌ Choisis d’abord la cible (⚙️ Options de DM ou ⭐ Définir le status).', ephemeral: true });
  await interaction.deferReply({ ephemeral: true });
  const targets = await resolveTargets(interaction.guild, session);
  const n = targets.length;
  if (!n) return interaction.editReply('❌ Personne à qui envoyer le DM avec cette cible.');
  // Sans token, Kayoshi n'envoie lui-même qu'à quelques membres : pas de DM de masse avec son compte.
  if (!session.rest && n > MAX_WITHOUT_TOKEN) {
    return interaction.editReply(
      `❌ Ajoute d’abord le token du bot qui envoie (➕ Définir le token) : sans token, Kayoshi n’envoie lui-même qu’à **${MAX_WITHOUT_TOKEN} membres** au plus (ici ${plural(n, 'membre')}).`,
    );
  }
  session.pending = targets;
  const minutes = Math.max(1, Math.round((n * (PAUSE_MIN_MS + PAUSE_MAX_MS)) / 2 / 60_000));
  return interaction.editReply({
    content:
      `⚠️ Envoyer le DM à **${plural(n, 'membre')}** avec **${session.botName ?? interaction.client.user.username}** ?\n` +
      `-# Environ ${minutes} min · tu pourras l’arrêter avec le bouton ⏹️ sur le panneau.`,
    components: [
      new ActionRowBuilder().addComponents(
        button('dml_confirm', `🚀 Envoyer à ${plural(n, 'membre')}`, ButtonStyle.Danger),
        button('dml_abort', 'Annuler', ButtonStyle.Secondary),
      ),
    ],
  });
}

async function startDmAll(interaction, session) {
  const { guild } = interaction;
  if (!session.pending?.length) return interaction.update({ content: '⌛ Confirmation expirée : reclique sur 🚀 DMall.', components: [] });
  const run = { stopped: false };
  runs.set(guild.id, run);
  sessions.delete(guild.id); // le token ne sert plus qu'à cet envoi
  await interaction.update({ content: '🚀 C’est parti : l’avancement s’affiche sur le panneau.', components: [] });
  runDmAll(interaction, session, run)
    .catch((err) => console.error('[dmall]', err))
    .finally(() => runs.delete(guild.id));
}

const DM_ERRORS = { closed: 50007 }; // MP fermés ou bot bloqué

async function runDmAll(interaction, session, run) {
  const { content, embed, panel, pending: targets } = session;
  // Sans token (5 membres au plus, vérifié à la confirmation) : Kayoshi envoie lui-même.
  const rest = session.rest ?? interaction.client.rest;
  const botName = session.botName ?? interaction.client.user.username;
  const stats = { sent: 0, closed: 0, failed: 0 };
  const startedAt = Date.now();
  let errorsInARow = 0;
  let stopReason = null;
  const show = (done) => panel.edit({ components: [progressContainer(stats, targets.length, botName, done, stopReason)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } }).catch(() => {});

  await show(false);
  for (const [i, userId] of targets.entries()) {
    if (run.stopped) {
      stopReason = '⏹️ Arrêté avec le bouton';
      break;
    }
    try {
      const dm = await rest.post(Routes.userChannels(), { body: { recipient_id: userId } });
      await rest.post(Routes.channelMessages(dm.id), {
        body: { ...(content.trim() ? { content } : {}), ...(embed ? { embeds: [embed] } : {}), allowed_mentions: { parse: [] } },
      });
      stats.sent++;
      errorsInARow = 0;
    } catch (err) {
      if (err.code === DM_ERRORS.closed) {
        stats.closed++;
        errorsInARow = 0;
      } else {
        stats.failed++;
        if (err.status === 401) stopReason = '🔑 Token refusé par Discord (réinitialisé ?)';
        else if (++errorsInARow >= MAX_ERRORS_IN_A_ROW) stopReason = `⚠️ ${MAX_ERRORS_IN_A_ROW} échecs d’affilée (${err.message})`;
        if (stopReason) break;
      }
    }
    if ((i + 1) % 10 === 0) await show(false);
    if (i + 1 < targets.length) await sleep(PAUSE_MIN_MS + Math.random() * (PAUSE_MAX_MS - PAUSE_MIN_MS));
  }
  await show(true);

  const done = stats.sent + stats.closed + stats.failed;
  const failures = stats.closed + stats.failed;
  const seconds = Math.round((Date.now() - startedAt) / 1000);
  const duration = seconds < 60 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
  const report = new ContainerBuilder()
    .setAccentColor(stopReason ? 0xfaa61a : 0x57f287)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `## 📨 Récapitulatif du DMall\n` +
          `✅ **${plural(stats.sent, 'envoi')} réussi${stats.sent > 1 ? 's' : ''}**\n` +
          `❌ **${plural(failures, 'échec')}**` +
          (failures ? ` (🔒 ${plural(stats.closed, 'MP fermé')} ou bot bloqué · ${plural(stats.failed, 'autre erreur')})` : '') +
          (stopReason ? `\n${stopReason} : ${plural(targets.length - done, 'membre')} non traité${targets.length - done > 1 ? 's' : ''}` : '') +
          `\n-# Envoyé par ${botName} en ${duration} · demandé par <@${interaction.user.id}>`,
      ),
    );
  await panel
    .reply({ components: [report], flags: MessageFlags.IsComponentsV2, allowedMentions: { users: [interaction.user.id] } })
    .catch((err) => console.error('[dmall] récapitulatif impossible :', err.message));
}

function progressContainer({ sent, closed, failed }, total, botName, finished, stopReason) {
  const done = sent + closed + failed;
  const filled = Math.round((done / total) * 16);
  const title = finished ? (stopReason ? '## ⏹️ DMall arrêté' : '## ✅ DMall terminé') : '## 📨 DMall en cours…';
  const container = new ContainerBuilder()
    .setAccentColor(finished ? (stopReason ? 0xfaa61a : 0x57f287) : COLOR)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent(
        `${title}\n${'▰'.repeat(filled)}${'▱'.repeat(16 - filled)} **${done} / ${total}**\n` +
          `✅ ${sent} envoyé${sent > 1 ? 's' : ''} · 🔒 ${closed} MP fermé${closed > 1 ? 's' : ''} · ❌ ${failed} autre${failed > 1 ? 's' : ''} échec${failed > 1 ? 's' : ''}` +
          (stopReason ? `\n${stopReason}` : '') +
          `\n-# Envoyé par ${botName} · un DM toutes les 1,5 à 2 s`,
      ),
    );
  if (!finished) {
    container.addActionRowComponents(new ActionRowBuilder().addComponents(button('dml_stop', '⏹️ Arrêter', ButtonStyle.Danger)));
  }
  return container;
}
