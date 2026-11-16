import {
  ActionRowBuilder,
  AuditLogEvent,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  Routes,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getSecurity, setSecurity } from './securityconfig.js';
import { getAntiNuke, setAntiNuke, isTrusted, sanctionStaff } from './antinuke.js';
import { multiSettings } from './antispam.js';
import { getAntiSpamConfig, setAntiSpamConfig, getLinkConfig, getPartner, addWarn } from './store.js';
import { INVITE, isForeignInvite } from './linkfilter.js';
import { sendLog, sendSanctionLog, Colors } from './logger.js';
import { recordSanction } from './sanctions.js';
import { persistUrl, readMedia } from './media.js';

// Sécurité du serveur (/config → Sécurité) : un panneau liste les protections ; chacune s'active, se désactive et se
// règle. Nouvelles ici : anti-mention, anti-invite, anti-everyone, anti-vanity, anti-modification du serveur,
// anti-déco vocaux et anti-bot. Le panneau règle aussi l'anti-spam (lib/antispam.js), l'anti-ban de masse
// (lib/antinuke.js) et l'anti-nuke ; l'anti-liens se règle avec /config → Anti-liens. Personne n'est sanctionné parmi les
// membres de confiance (isTrusted : propriétaire, /config → Anti-nuke → Ajouter un membre de confiance…).

const MENTION_USER = /<@!?(\d{17,20})>/g;
const MENTION_ROLE = /<@&(\d{17,20})>/g;
const distinct = (text, re) => new Set([...text.matchAll(re)].map((m) => m[1])).size;

// --- Messages : anti-everyone, anti-mention, anti-invite ---

// Renvoie true si le message a été supprimé.
export async function handleSecurityMessage(message) {
  if (!message.guild || message.author.bot || !message.member) return false;
  const { guild, member } = message;
  if (isTrusted(guild, message.author.id)) return false;

  // @everyone / @here qui a vraiment notifié (l'auteur en a la permission) sans être de confiance.
  if (getSecurity(guild.id, 'everyone').enabled && message.mentions.everyone) {
    await removeWithNotice(message, 'pas de **@everyone / @here** sans autorisation.');
    await logBlocked(message, '🚫 Anti-everyone', 'a mentionné @everyone / @here sans autorisation', 'message supprimé');
    return true;
  }
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return false; // le staff passe, comme pour l'anti-spam

  const mention = getSecurity(guild.id, 'mention');
  if (mention.enabled) {
    const users = distinct(message.content, MENTION_USER);
    const roles = distinct(message.content, MENTION_ROLE);
    if (users > mention.users || roles > mention.roles) {
      const ms = mention.muteMin * 60_000;
      const muted = ms > 0 && member.moderatable && (await member.timeout(ms, 'Anti-mention : trop de mentions').then(() => true).catch(() => false));
      if (muted) recordSanction(guild.id, message.author.id, 'mute', { reason: 'Anti-mention : trop de mentions', durationMs: ms });
      await removeWithNotice(message, `trop de mentions dans un message${muted ? ` : mute **${mention.muteMin} min**` : ''}.`);
      await logBlocked(
        message,
        '📢 Anti-mention',
        `a mentionné ${users} membre(s) et ${roles} rôle(s) dans un message`,
        muted ? `🔇 mute ${mention.muteMin} min + message supprimé` : 'message supprimé',
      );
      return true;
    }
  }

  if (getSecurity(guild.id, 'invite').enabled && INVITE.test(message.content) && !isPartnerChannel(message.channel)) {
    const urls = message.content.match(new RegExp(INVITE.source, 'gi')) ?? [];
    for (const url of urls) {
      if (!(await isForeignInvite(url, guild))) continue;
      const reason = 'Anti-invite : invitation vers un autre serveur';
      const { warns } = addWarn(guild.id, message.author.id, { reason, moderatorId: message.client.user.id });
      await removeWithNotice(message, `pas d’invitation vers un autre serveur : **avertissement** (${warns.length} au total).`);
      await logBlocked(message, '🔗 Anti-invite', 'a posté une invitation vers un autre serveur', `message supprimé + avertissement (${warns.length} au total)`);
      return true;
    }
  }
  return false;
}

// Salon partenariat (/embed → Partenariat) et tickets de la catégorie « Partenariat » : les invitations y sont normales.
function isPartnerChannel(channel) {
  return channel.id === getPartner(channel.guild.id).channelId || Boolean(channel.parent?.name?.toLowerCase().includes('partenariat'));
}

async function removeWithNotice(message, text) {
  await message.delete().catch(() => {});
  const notice = await message.channel.send({ content: `⚠️ ${message.author}, ${text}`, allowedMentions: { users: [message.author.id] } }).catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => {}), 6000);
}

async function logBlocked(message, title, what, sanction) {
  await sendSanctionLog(
    message.guild,
    new EmbedBuilder()
      .setColor(Colors.delete)
      .setAuthor({ name: title })
      .setDescription(`${message.author} (${message.author.tag}) ${what} dans ${message.channel}`)
      .addFields(
        { name: 'Sanction', value: sanction, inline: true },
        { name: 'Message', value: message.content.slice(0, 1000) || '—' },
      )
      .setTimestamp(),
  );
}

// --- Journal d'audit ---

// Auteur de la dernière action de ce type (sur `targetId` si donné), dans les 15 dernières secondes.
// Le journal peut arriver juste après l'événement : un second essai après 1,5 s.
async function lastExecutor(guild, type, targetId) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const logs = await guild.fetchAuditLogs({ type, limit: 5 }).catch(() => null);
    const entry = logs?.entries.find((e) => Date.now() - e.createdTimestamp < 15_000 && (!targetId || e.targetId === targetId));
    if (entry?.executor) return entry.executor;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return null;
}

async function alert(guild, title, description) {
  const embed = new EmbedBuilder().setColor(0xe74c3c).setTitle(title).setDescription(description).setTimestamp();
  await sendLog(guild, embed);
  const owner = await guild.fetchOwner().catch(() => null);
  await owner?.send({ content: `Sur **${guild.name}** :`, embeds: [embed] }).catch(() => {});
}

// --- Serveur modifié : anti-vanity-URL et anti-modification (nom, icône, bannière, fond d'invitation) ---

const SERVER_FIELDS = { name: 'le nom', icon: 'l’icône', banner: 'la bannière', splash: 'le fond d’invitation' };

// Copie du nom et des images du serveur, gardées par le bot pour pouvoir les remettre.
export async function takeServerSnapshot(guild) {
  const keep = async (url) => (url ? persistUrl(guild.id, url, () => true) : null);
  return {
    name: guild.name,
    icon: await keep(guild.iconURL({ extension: 'png', size: 1024 })),
    banner: await keep(guild.bannerURL({ extension: 'png', size: 1024 })),
    splash: await keep(guild.splashURL({ extension: 'png', size: 1024 })),
  };
}

export async function handleSecurityGuildUpdate(oldGuild, guild) {
  const vanity = getSecurity(guild.id, 'vanity');
  const update = getSecurity(guild.id, 'update');
  const vanityChanged = vanity.enabled && oldGuild.vanityURLCode !== guild.vanityURLCode;
  const changed = update.enabled ? Object.keys(SERVER_FIELDS).filter((k) => oldGuild[k] !== guild[k]) : [];
  if (!vanityChanged && !changed.length) return;

  const executor = await lastExecutor(guild, AuditLogEvent.GuildUpdate);
  if (!executor || executor.id === guild.client.user.id) return; // inconnu, ou le bot qui vient de tout remettre
  if (isTrusted(guild, executor.id)) {
    // Changement autorisé : il devient la nouvelle référence.
    if (vanityChanged) setSecurity(guild.id, 'vanity', { code: guild.vanityURLCode });
    if (changed.length) setSecurity(guild.id, 'update', { snapshot: await takeServerSnapshot(guild) });
    return;
  }

  if (vanityChanged) {
    const code = vanity.code ?? oldGuild.vanityURLCode;
    const ok =
      code &&
      (await guild.client.rest
        .patch(Routes.guildVanityUrl(guild.id), { body: { code }, reason: `Anti-vanity : changée par ${executor.tag} sans autorisation` })
        .then(() => true)
        .catch((err) => (console.error('[sécurité] vanity :', err.message), false)));
    await alert(
      guild,
      '🪪 Anti-vanity-URL',
      `${executor} (\`${executor.tag}\`) a changé l’URL personnalisée du serveur.\n\n` +
        (ok ? `➡️ \`discord.gg/${code}\` remise.` : `⚠️ Je n’ai pas pu remettre \`discord.gg/${code ?? '?'}\` : remets-la à la main.`),
    );
  }

  if (changed.length) {
    const snapshot = update.snapshot;
    const edit = {};
    for (const key of changed) {
      if (!snapshot) break;
      if (key === 'name') edit.name = snapshot.name;
      else if (!snapshot[key]) edit[key] = null;
      else {
        const media = await readMedia(snapshot[key]);
        if (media) edit[key] = media.buffer;
      }
    }
    const restored = Object.keys(edit);
    const ok =
      restored.length &&
      (await guild
        .edit({ ...edit, reason: `Anti-modification : changé par ${executor.tag} sans autorisation` })
        .then(() => true)
        .catch((err) => (console.error('[sécurité] serveur :', err.message), false)));
    await alert(
      guild,
      '🛡️ Anti-modification du serveur',
      `${executor} (\`${executor.tag}\`) a modifié ${changed.map((k) => SERVER_FIELDS[k]).join(', ')} du serveur sans autorisation.\n\n` +
        (ok ? `➡️ Remis comme avant : ${restored.map((k) => SERVER_FIELDS[k]).join(', ')}.` : '⚠️ Je n’ai pas pu tout remettre comme avant : vérifie à la main.'),
    );
  }
}

// --- Anti-déco vocaux : membres déconnectés du vocal par un membre du staff ---
// Discord regroupe les déconnexions d'une même personne dans une seule entrée du journal, dont le compteur
// (extra.count) augmente : on compte ce qui s'ajoute depuis la dernière lecture.
const decoSeen = new Map(); // guildId → Map(entrée → compteur lu)
const decoDone = new Map(); // `${guildId}:${userId}` → [instants]

export async function handleSecurityVoiceLeave(oldState, newState) {
  if (!oldState.channelId || newState.channelId) return;
  const { guild } = oldState;
  const deco = getSecurity(guild.id, 'deco');
  if (!deco.enabled) return;
  const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberDisconnect, limit: 5 }).catch(() => null);
  if (!logs) return;
  const now = Date.now();
  const windowMs = deco.seconds * 1000;
  const previous = decoSeen.get(guild.id) ?? new Map();
  const seen = new Map();
  for (const entry of logs.entries.values()) {
    const count = entry.extra?.count ?? 1;
    seen.set(entry.id, count);
    const before = previous.get(entry.id);
    const added = before === undefined ? (now - entry.createdTimestamp < windowMs ? count : 0) : count - before;
    if (added <= 0 || !entry.executor || isTrusted(guild, entry.executor.id)) continue;
    const key = `${guild.id}:${entry.executor.id}`;
    const recent = (decoDone.get(key) ?? []).filter((t) => now - t < windowMs);
    for (let i = 0; i < added; i++) recent.push(now);
    decoDone.set(key, recent);
    if (recent.length >= deco.max) {
      await sanctionStaff(guild, entry.executor, {
        title: '🔌 Anti-déco vocaux déclenché',
        what: `**${recent.length} membres déconnectés du vocal** en moins de ${deco.seconds} s`,
        reason: `Anti-déco vocaux : ${recent.length} membres déconnectés en moins de ${deco.seconds} s`,
      }).catch((err) => console.error('[sécurité] déco :', err));
    }
  }
  decoSeen.set(guild.id, seen);
}

// --- Anti-bot : un bot ajouté par quelqu'un qui n'est pas de confiance est expulsé, et celui qui l'a ajouté derank ---

export async function handleBotJoin(member) {
  if (!member.user.bot || !getSecurity(member.guild.id, 'bot').enabled) return;
  const { guild } = member;
  const executor = await lastExecutor(guild, AuditLogEvent.BotAdd, member.id);
  if (!executor || isTrusted(guild, executor.id)) return;
  const reason = `Anti-bot : ${member.user.tag} ajouté par ${executor.tag} sans autorisation`;
  const kicked = await member.kick(reason).then(() => true).catch(() => false);
  const sanctioned = await sanctionStaff(guild, executor, {
    title: '🤖 Anti-bot déclenché',
    what: `a ajouté le bot **${member.user.tag}** sans autorisation (bot ${kicked ? '**expulsé**' : 'que je n’ai **pas pu expulser**'})`,
    reason,
  }).catch(() => false);
  if (!sanctioned) await alert(guild, '🤖 Anti-bot', `${executor} a ajouté le bot **${member.user.tag}** : ${kicked ? 'bot expulsé' : '⚠️ bot pas expulsé'}.`);
}

// --- Panneau /config → Sécurité ---

// Chaque protection : où sont ses réglages (get, toggle, save) et ce qu'on peut régler (fields : [clé, libellé, min, max]).
const own = (key, fields = []) => ({
  get: (guild) => getSecurity(guild.id, key),
  toggle: (guild, on) => setSecurity(guild.id, key, { enabled: on }),
  save: (guild, values) => setSecurity(guild.id, key, values),
  fields,
});
const SPAM_DEFAULTS = { maxMessages: 5, intervalMs: 5000, timeoutMs: 300_000 };

const PROTECTIONS = [
  {
    key: 'mention', emoji: '📢', name: 'Anti-Mention-Spam',
    about: 'Mute si plus de N mentions de membres ou de M mentions de rôles dans un message',
    ...own('mention', [['users', 'Mentions de membres autorisées', 1, 50], ['roles', 'Mentions de rôles autorisées', 0, 20], ['muteMin', 'Durée du mute (minutes)', 0, 1440]]),
    summary: (s) => `plus de ${s.users} membres ou ${s.roles} rôles mentionnés → mute ${s.muteMin} min`,
  },
  {
    key: 'spam', emoji: '💬', name: 'Anti-Spam-Messages',
    about: 'Mute si X messages en Y secondes',
    get: (guild) => {
      const c = { ...SPAM_DEFAULTS, ...(getAntiSpamConfig(guild.id) ?? {}) };
      return { enabled: Boolean(c.enabled), messages: c.maxMessages, seconds: Math.round(c.intervalMs / 1000), muteMin: Math.round(c.timeoutMs / 60_000) };
    },
    toggle: (guild, on) => setAntiSpamConfig(guild.id, { ...SPAM_DEFAULTS, ...(getAntiSpamConfig(guild.id) ?? {}), enabled: on }),
    save: (guild, v) =>
      setAntiSpamConfig(guild.id, { ...SPAM_DEFAULTS, ...(getAntiSpamConfig(guild.id) ?? {}), maxMessages: v.messages, intervalMs: v.seconds * 1000, timeoutMs: v.muteMin * 60_000 }),
    fields: [['messages', 'Nombre de messages', 2, 30], ['seconds', 'En combien de secondes', 2, 60], ['muteMin', 'Durée du mute (minutes, 0 = aucun)', 0, 1440]],
    summary: (s) => `${s.messages} messages en ${s.seconds} s → mute ${s.muteMin} min`,
  },
  {
    key: 'multi', emoji: '📮', name: 'Anti-Spam-Multi-Salons',
    about: 'Mute ou ban si le même message est posté dans N salons différents',
    get: (guild) => multiSettings(getAntiSpamConfig(guild.id)),
    toggle: (guild, on) => {
      const cfg = getAntiSpamConfig(guild.id) ?? {};
      setAntiSpamConfig(guild.id, { ...cfg, multi: { ...multiSettings(cfg), enabled: on } });
    },
    save: (guild, v) => {
      const cfg = getAntiSpamConfig(guild.id) ?? {};
      setAntiSpamConfig(guild.id, { ...cfg, multi: { ...multiSettings(cfg), ...v } });
    },
    fields: [['channels', 'Nombre de salons (même message)', 2, 10], ['sanction', 'Sanction : mute (1 h) ou ban', 'mute', 'ban']],
    summary: (s) => `même message dans ${s.channels} salons en 10 s → ${s.sanction === 'ban' ? 'ban' : 'mute 1 h'}`,
  },
  {
    key: 'invite', emoji: '🔗', name: 'Anti-Invite',
    about: 'Supprime les invitations discord.gg/ vers d’autres serveurs et avertit l’auteur',
    ...own('invite'),
    summary: () => 'invitation vers un autre serveur → message supprimé + avertissement (sauf salon et tickets partenariat)',
  },
  {
    key: 'link', emoji: '🌐', name: 'Anti-Link',
    about: 'Supprime les liens hors whitelist (réglé salon par salon et rôle par rôle)',
    get: (guild) => ({ enabled: Boolean(getLinkConfig(guild.id)?.roleIds?.length) }),
    note: 'Se règle avec `/config → Anti-liens` : rôles filtrés, salons et rôles autorisés.',
    summary: () => 'réglé avec /config → Anti-liens',
  },
  {
    key: 'everyone', emoji: '🚫', name: 'Anti-Everyone',
    about: 'Bloque les @everyone / @here non autorisés',
    ...own('everyone'),
    summary: () => '@everyone / @here d’un membre qui n’est pas de confiance → message supprimé',
  },
  {
    key: 'nuke', emoji: '💣', name: 'Anti-Nuke',
    about: 'Derank si des salons / rôles sont créés ou supprimés en masse par la même personne',
    get: (guild) => ({ enabled: getAntiNuke(guild.id).enabled }),
    toggle: (guild, on) => setAntiNuke(guild.id, { enabled: on }),
    note: 'En 1 min : 3 salons ou 3 rôles supprimés, 8 créés, ou 5 expulsions. Membres de confiance : `/config → Anti-nuke → Ajouter un membre de confiance`.',
    summary: () => 'suppressions / créations / expulsions en masse → derank',
  },
  {
    key: 'vanity', emoji: '🪪', name: 'Anti-Vanity-URL',
    about: 'Restaure l’URL personnalisée du serveur (discord.gg/xxx) si quelqu’un la change',
    get: (guild) => getSecurity(guild.id, 'vanity'),
    toggle: (guild, on) => setSecurity(guild.id, 'vanity', { enabled: on, ...(on ? { code: guild.vanityURLCode } : {}) }),
    summary: (s) => (s.code ? `URL gardée : discord.gg/${s.code}` : 'le serveur n’a pas d’URL personnalisée'),
  },
  {
    key: 'update', emoji: '🛡️', name: 'Anti-Update-Serveur',
    about: 'Restaure le nom, l’icône, la bannière et le fond d’invitation s’ils sont modifiés sans autorisation',
    get: (guild) => getSecurity(guild.id, 'update'),
    toggle: async (guild, on) => setSecurity(guild.id, 'update', { enabled: on, ...(on ? { snapshot: await takeServerSnapshot(guild) } : {}) }),
    summary: (s) => (s.snapshot ? `sauvegarde : « ${s.snapshot.name} »` : 'sauvegarde prise à l’activation'),
  },
  {
    key: 'ban', emoji: '🔨', name: 'Anti-Ban-Masse',
    about: 'Derank si un membre du staff bannit X membres en Y secondes',
    ...own('ban', [['max', 'Nombre de bans', 2, 50], ['seconds', 'En combien de secondes', 10, 3600]]),
    summary: (s) => `${s.max} bans en ${s.seconds} s → derank`,
  },
  {
    key: 'deco', emoji: '🔌', name: 'Anti-Déco-Vocaux',
    about: 'Derank si un membre du staff déconnecte X membres du vocal en Y secondes',
    ...own('deco', [['max', 'Nombre de déconnexions', 2, 50], ['seconds', 'En combien de secondes', 10, 3600]]),
    summary: (s) => `${s.max} déconnexions en ${s.seconds} s → derank`,
  },
  {
    key: 'bot', emoji: '🤖', name: 'Anti-Bot',
    about: 'Expulse un bot ajouté sans autorisation et derank celui qui l’a ajouté',
    ...own('bot'),
    summary: () => 'bot ajouté par un membre qui n’est pas de confiance → bot expulsé + derank',
  },
];
const byKey = new Map(PROTECTIONS.map((p) => [p.key, p]));
const COLOR = 0x5865f2;
const TRUST_NOTE = 'Jamais sanctionnés : le propriétaire et les membres de confiance (/config → Anti-nuke → Ajouter un membre de confiance).';

export function securityHome(guild) {
  const lines = PROTECTIONS.map((p) => {
    const s = p.get(guild);
    return `${s.enabled ? '✅' : '❌'} ${p.emoji} **${p.name}** — ${s.enabled ? p.summary(s) : 'désactivé'}`;
  });
  const select = new StringSelectMenuBuilder()
    .setCustomId('sec:pick')
    .setPlaceholder('🛡️ Choisis une protection à régler…')
    .addOptions(PROTECTIONS.map((p) => ({ label: p.name, value: p.key, description: p.about.slice(0, 100), emoji: p.emoji })));
  return {
    embeds: [new EmbedBuilder().setColor(COLOR).setTitle('🛡️ Sécurité du serveur').setDescription(lines.join('\n')).setFooter({ text: TRUST_NOTE })],
    components: [new ActionRowBuilder().addComponents(select)],
  };
}

function detail(guild, p, notice = '') {
  const s = p.get(guild);
  const settings = (p.fields ?? []).map(([field, label]) => `• ${label} : **${s[field]}**`).join('\n');
  const embed = new EmbedBuilder()
    .setColor(s.enabled ? 0x57f287 : 0xed4245)
    .setTitle(`${p.emoji} ${p.name} — ${s.enabled ? 'activé' : 'désactivé'}`)
    .setDescription([notice, p.about, s.enabled ? `➡️ ${p.summary(s)}` : '', settings, p.note ? `-# ${p.note}` : ''].filter(Boolean).join('\n\n'))
    .setFooter({ text: TRUST_NOTE });
  const buttons = [];
  if (p.toggle) {
    buttons.push(
      new ButtonBuilder()
        .setCustomId(`sec:toggle:${p.key}`)
        .setLabel(s.enabled ? 'Désactiver' : 'Activer')
        .setStyle(s.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
    );
  }
  if (p.fields?.length) buttons.push(new ButtonBuilder().setCustomId(`sec:edit:${p.key}`).setLabel('⚙️ Réglages').setStyle(ButtonStyle.Primary));
  buttons.push(new ButtonBuilder().setCustomId('sec:home').setLabel('↩️ Toutes les protections').setStyle(ButtonStyle.Secondary));
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(buttons)] };
}

function settingsModal(guild, p) {
  const s = p.get(guild);
  return new ModalBuilder()
    .setCustomId(`sec:modal:${p.key}`)
    .setTitle(p.name.slice(0, 45))
    .addLabelComponents(
      p.fields.map(([field, label, min, max]) =>
        new LabelBuilder()
          .setLabel(label)
          .setDescription(typeof min === 'number' ? `Entre ${min} et ${max}` : `« ${min} » ou « ${max} »`)
          .setTextInputComponent(new TextInputBuilder().setCustomId(field).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6).setValue(String(s[field]))),
      ),
    );
}

// Boutons, menu et formulaire « sec:… » (administrateurs).
export async function handleSecurityInteraction(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Réservé aux administrateurs.', ephemeral: true });
  }
  const [, action, key] = interaction.customId.split(':');
  const { guild } = interaction;
  if (action === 'home') return interaction.update(securityHome(guild));
  const p = byKey.get(action === 'pick' ? interaction.values[0] : key);
  if (!p) return interaction.update(securityHome(guild));
  if (action === 'pick') return interaction.update(detail(guild, p));
  if (action === 'toggle' && p.toggle) {
    await interaction.deferUpdate();
    await p.toggle(guild, !p.get(guild).enabled);
    return interaction.editReply(detail(guild, p));
  }
  if (action === 'edit' && p.fields?.length) return interaction.showModal(settingsModal(guild, p));
  if (action === 'modal' && p.fields?.length) {
    const values = {};
    for (const [field, label, min, max] of p.fields) {
      const raw = interaction.fields.getTextInputValue(field).trim().toLowerCase();
      if (typeof min === 'number') {
        const n = Number(raw);
        if (!Number.isInteger(n) || n < min || n > max) return interaction.update(detail(guild, p, `❌ ${label} : un nombre entier entre ${min} et ${max}.`));
        values[field] = n;
      } else {
        if (raw !== min && raw !== max) return interaction.update(detail(guild, p, `❌ ${label} : écris « ${min} » ou « ${max} ».`));
        values[field] = raw;
      }
    }
    p.save(guild, values);
    return interaction.update(detail(guild, p, '✅ Réglages enregistrés.'));
  }
}
