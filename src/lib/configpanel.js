import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  PermissionsBitField,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import configniveau from '../commands/config/configniveau.js';
import configeconomie from '../commands/config/configeconomie.js';
import inviteconfig from '../commands/config/inviteconfig.js';
import antispam from '../commands/config/antispam.js';
import antinuke from '../commands/config/antinuke.js';
import avisticket from '../commands/config/avisticket.js';
import securite from '../commands/config/securite.js';
import configconfessions from '../commands/config/configconfessions.js';
import configlien from '../commands/config/configlien.js';
import configboost from '../commands/config/configboost.js';
import configrank from '../commands/config/configrank.js';
import configshop from '../commands/config/configshop.js';
import configstat from '../commands/config/configstat.js';
import configticket from '../commands/config/configticket.js';
import configvocal from '../commands/config/configvocal.js';
import log from '../commands/config/log.js';
import messimage from '../commands/config/messimage.js';
import coiffeur from '../commands/config/coiffeur.js';
import compteur from '../commands/config/compteur.js';
import salonStats from '../commands/config/salon-stats.js';
import sanction from '../commands/config/sanction.js';
import bienvenue from '../commands/config/bienvenue.js';
import quitte from '../commands/config/quitte.js';
import dmjoin from '../commands/config/dmjoin.js';
import configverif from '../commands/config/configverif.js';
import bremind from '../commands/config/bremind.js';
import bremindEdit from '../commands/config/bremind-edit.js';
import sport from '../commands/config/sport.js';
import {
  getGuildConfig,
  getLevelsEnabled,
  getGreetConfig,
  getVerifConfig,
  getDmJoin,
  getBoostConfig,
  getTicketConfig,
  getAvisConfig,
  getAntiSpamConfig,
  getLinkConfig,
  getConfessionConfig,
  getMoneyDrops,
  getWeeklyTop,
  getRankConfig,
  getStatConfig,
  getInviteLogChannel,
  getVoiceConfig,
  getCounting,
  getCoiffeurEnabled,
  getGifHint,
  getBumpReminder,
} from './store.js';
import { getAntiNuke } from './antinuke.js';
import { getSportConfig } from './sport.js';

// /config : un panneau (éphémère) avec un bouton par système, vert quand il est activé. Un clic montre ses actions
// (Activer, Désactiver, Voir, Salon…) ; chaque action appelle tel quel le code de l'ancienne commande (dossier
// commands/config) avec les informations qu'elle attend, demandées selon le cas :
// - aucune : l'action se lance directement ;
// - un seul salon / rôle / membre : un menu de choix dans le panneau (après lequel la commande peut ouvrir son
//   propre formulaire, ce qu'un formulaire ne permet pas) ;
// - sinon : un formulaire, sur deux pages s'il faut plus de 5 champs (limite de Discord).
// Les options numérotées (salon_1, salon_2… ; top1_messages, top2_messages…) sont regroupées en un seul champ.

const entry = (key, emoji, label, target, status = () => null) => ({ key, emoji, label, target, status });
const group = (about, modules) => ({ about, modules });
const ENTRIES = [
  entry('niveau', '📈', 'Niveaux', configniveau, (g) => getLevelsEnabled(g.id)),
  entry(
    'accueil',
    '👋',
    'Accueil',
    group('Arrivées : message de bienvenue, de départ, message privé d’arrivée et vérification anti-bot.', {
      bienvenue: ['Bienvenue', bienvenue],
      depart: ['Départ', quitte],
      mp: ['MP d’arrivée', dmjoin],
      verif: ['Vérification', configverif],
    }),
    (g) => Boolean(getGreetConfig(g.id, 'welcome') || getVerifConfig(g.id) || getDmJoin(g.id)?.message),
  ),
  entry('boost', '🚀', 'Boost', configboost, (g) => Boolean(getBoostConfig(g.id)?.channelId)),
  entry('ticket', '🎫', 'Tickets', configticket, (g) => Boolean(getTicketConfig(g.id)?.motifs?.length)),
  entry('avis-ticket', '⭐', 'Avis tickets', avisticket, (g) => Object.values(getAvisConfig(g.id)?.channels ?? {}).some(Boolean)),
  entry('securite', '🛡️', 'Sécurité', securite),
  entry('antispam', '💬', 'Anti-spam', antispam, (g) => Boolean(getAntiSpamConfig(g.id)?.enabled)),
  entry('antinuke', '💣', 'Anti-nuke', antinuke, (g) => getAntiNuke(g.id).enabled),
  entry('lien', '🔗', 'Anti-liens', configlien, (g) => Boolean(getLinkConfig(g.id)?.roleIds?.length)),
  entry('logs', '📜', 'Logs', log, (g) => Boolean(getGuildConfig(g.id).logChannelId)),
  entry('sanctions', '⚖️', 'Sanctions', sanction, (g) => Boolean(getGuildConfig(g.id).sanctionChannelId)),
  entry('confessions', '🤫', 'Confessions', configconfessions, (g) => Boolean(getConfessionConfig(g.id)?.channelId)),
  entry('economie', '💰', 'Économie', configeconomie, (g) => Boolean(getMoneyDrops(g.id)?.enabled || getWeeklyTop(g.id)?.enabled)),
  entry('boutique', '🛒', 'Boutique', configshop),
  entry('rank', '🎖️', 'Rank / derank', configrank, (g) => Boolean(getRankConfig(g.id)?.channelId)),
  entry('classement', '📊', 'Classement', configstat, (g) => Boolean(getStatConfig(g.id)?.channelId)),
  entry('invitations', '📨', 'Invitations', inviteconfig, (g) => Boolean(getInviteLogChannel(g.id))),
  entry('vocal', '🔊', 'Vocaux temporaires', configvocal, (g) => Boolean(getVoiceConfig(g.id)?.generatorChannelId)),
  entry('salon-stats', '📶', 'Salons de stats', salonStats, (g) => Object.keys(getGuildConfig(g.id).statChannels?.channels ?? {}).length > 0),
  entry('compteur', '🔢', 'Compteur', compteur, (g) => Boolean(getCounting(g.id)?.channelId)),
  entry('coiffeur', '💇', 'Coiffeur', coiffeur, (g) => getCoiffeurEnabled(g.id)),
  entry('messimage', '🖼️', 'Message GIF', messimage, (g) => Boolean(getGifHint(g.id)?.message)),
  entry(
    'bump',
    '⏰',
    'Rappel de bump',
    group('Rappel de bump Disboard (2 h après chaque /bump) et ses messages.', { rappel: ['Rappel', bremind], message: ['Messages', bremindEdit] }),
    (g) => Boolean(getBumpReminder(g.id).enabled),
  ),
  entry('sport', '⚽', 'Sport', sport, (g) => Boolean(getSportConfig(g.id).footballChannelId || getSportConfig(g.id).ufcChannelId)),
];
const byKey = new Map(ENTRIES.map((e) => [e.key, e]));

const SUB_COMMAND = 1;
const ACTION_LABELS = {
  activer: 'Activer',
  desactiver: 'Désactiver',
  voir: 'Voir',
  message: 'Message',
  drops: 'Drops d’argent',
  semaine: 'Membres de la semaine',
  salon: 'Salon',
  ajouter: 'Ajouter un membre de confiance',
  retirer: 'Retirer un membre de confiance',
};
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Actions d'un système : ses sous-commandes, ses commandes (groupe), ou « Configurer ».
function actionsOf(e) {
  if (e.target.modules) {
    return Object.entries(e.target.modules).map(([id, [label, mod]]) => {
      const json = mod.data.toJSON();
      return { id, label, mod, sub: null, description: json.description, options: json.options ?? [] };
    });
  }
  const json = e.target.data.toJSON();
  const subs = (json.options ?? []).filter((o) => o.type === SUB_COMMAND);
  if (!subs.length) return [{ id: '-', label: 'Configurer', mod: e.target, sub: null, description: json.description, options: json.options ?? [] }];
  return subs.map((s) => ({
    id: s.name,
    label: ACTION_LABELS[s.name] ?? capitalize(s.name.replace(/-/g, ' ')),
    mod: e.target,
    sub: s.name,
    description: s.description,
    options: s.options ?? [],
  }));
}

const safeStatus = (e, guild) => {
  try {
    return e.status(guild);
  } catch {
    return null;
  }
};

// --- Vues ---

export function configHome(guild, note = '') {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('⚙️ Configuration de Kayoshi')
    .setDescription(`${note ? `${note}\n\n` : ''}Clique sur un système pour l’activer, le désactiver ou le régler.\n🟢 activé · ⚪ pas encore configuré`)
    .setFooter({ text: 'Chaque réglage demande la même permission qu’avant (souvent administrateur).' });
  const buttons = ENTRIES.map((e) =>
    new ButtonBuilder()
      .setCustomId(`cfgp:open:${e.key}`)
      .setLabel(e.label)
      .setEmoji(e.emoji)
      .setStyle(safeStatus(e, guild) ? ButtonStyle.Success : ButtonStyle.Secondary),
  );
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  return { embeds: [embed], components: rows };
}

function entryView(guild, e, note = '') {
  const status = safeStatus(e, guild);
  const actions = actionsOf(e);
  const about = e.target.about ?? e.target.data.toJSON().description;
  const lines = [
    note,
    about,
    status === null ? '' : status ? '🟢 **Activé**' : '⚪ **Pas encore configuré**',
    actions.length > 1 ? actions.map((a) => `• **${a.label}** — ${a.description}`).join('\n') : '',
  ];
  const embed = new EmbedBuilder().setColor(status ? 0x57f287 : 0x5865f2).setTitle(`${e.emoji} ${e.label}`).setDescription(lines.filter(Boolean).join('\n\n'));
  const style = (id) => (id === 'activer' ? ButtonStyle.Success : id === 'desactiver' ? ButtonStyle.Danger : ButtonStyle.Primary);
  const buttons = actions.map((a) => new ButtonBuilder().setCustomId(`cfgp:run:${e.key}:${a.id}`).setLabel(a.label.slice(0, 80)).setStyle(style(a.id)));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  rows.push(new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cfgp:home').setLabel('↩️ Tous les systèmes').setStyle(ButtonStyle.Secondary)));
  return { embeds: [embed], components: rows };
}

// --- Champs à demander (une option, ou plusieurs options numérotées regroupées) ---

const OPTION = { STRING: 3, INTEGER: 4, BOOLEAN: 5, USER: 6, CHANNEL: 7, ROLE: 8, MENTIONABLE: 9, NUMBER: 10, ATTACHMENT: 11 };
const SELECTS = [OPTION.USER, OPTION.CHANNEL, OPTION.ROLE];
const GROUPABLE = [...SELECTS, OPTION.INTEGER, OPTION.NUMBER];

function fieldsOf(options) {
  const fields = [];
  for (const o of options) {
    const key = o.name.replace(/\d+/g, '#');
    const same = GROUPABLE.includes(o.type) && key !== o.name ? fields.find((f) => f.key === key && f.type === o.type) : null;
    if (same) {
      same.names.push(o.name);
      continue;
    }
    fields.push({ key, id: `f${fields.length}`, type: o.type, names: [o.name], option: o });
  }
  return fields;
}

const pretty = (f) => {
  const base = capitalize(f.key.replace(/_/g, ' ').replace(/#/g, f.names.length > 1 ? '' : '#').replace(/\s+/g, ' ').trim()).replace(/\b([Rr])ole\b/g, '$1ôle');
  if (f.names.length === 1) return base;
  return SELECTS.includes(f.type) ? `${base} (jusqu’à ${f.names.length})` : `${base} (${f.names.length} nombres)`;
};

function fieldComponent(f) {
  const o = f.option;
  const required = Boolean(o.required);
  const label = new LabelBuilder().setLabel(pretty(f).slice(0, 45));
  const description =
    f.names.length > 1 && !SELECTS.includes(f.type) ? `Dans l’ordre (${f.names.join(', ')}), séparés par des espaces` : o.description;
  if (description) label.setDescription(description.slice(0, 100));
  const many = f.names.length;
  if (o.type === OPTION.CHANNEL) {
    const select = new ChannelSelectMenuBuilder().setCustomId(f.id).setRequired(required).setMinValues(required ? 1 : 0).setMaxValues(many);
    if (o.channel_types?.length) select.addChannelTypes(...o.channel_types);
    return label.setChannelSelectMenuComponent(select);
  }
  if (o.type === OPTION.ROLE) return label.setRoleSelectMenuComponent(new RoleSelectMenuBuilder().setCustomId(f.id).setRequired(required).setMinValues(required ? 1 : 0).setMaxValues(many));
  if (o.type === OPTION.USER) return label.setUserSelectMenuComponent(new UserSelectMenuBuilder().setCustomId(f.id).setRequired(required).setMinValues(required ? 1 : 0).setMaxValues(many));
  if (o.type === OPTION.ATTACHMENT) return label.setFileUploadComponent(new FileUploadBuilder().setCustomId(f.id).setRequired(required));
  if (o.type === OPTION.BOOLEAN || o.choices?.length) {
    const choices = o.type === OPTION.BOOLEAN ? [{ name: 'Oui', value: 'true' }, { name: 'Non', value: 'false' }] : o.choices;
    const select = new StringSelectMenuBuilder()
      .setCustomId(f.id)
      .setRequired(required)
      .setMinValues(required ? 1 : 0)
      .setMaxValues(1)
      .addOptions(choices.map((c) => ({ label: String(c.name).slice(0, 100), value: String(c.value) })));
    return label.setStringSelectMenuComponent(select);
  }
  const number = o.type === OPTION.INTEGER || o.type === OPTION.NUMBER;
  const long = !number && (/message|description|texte/.test(o.name) || (o.max_length ?? 0) > 150);
  const input = new TextInputBuilder()
    .setCustomId(f.id)
    .setStyle(long ? TextInputStyle.Paragraph : TextInputStyle.Short)
    .setRequired(required)
    .setMaxLength(Math.min(o.max_length ?? (number ? 100 : 4000), 4000));
  if (number && o.min_value != null && o.max_value != null) input.setPlaceholder(`entre ${o.min_value} et ${o.max_value}`);
  return label.setTextInputComponent(input);
}

// Valeurs tapées ou choisies dans un formulaire → { valeurs par nom d'option } ou { error }.
function readFields(interaction, fields) {
  const values = {};
  for (const f of fields) {
    const o = f.option;
    const number = o.type === OPTION.INTEGER || o.type === OPTION.NUMBER;
    if (SELECTS.includes(o.type)) {
      const picked =
        o.type === OPTION.CHANNEL
          ? interaction.fields.getSelectedChannels(f.id)
          : o.type === OPTION.ROLE
            ? interaction.fields.getSelectedRoles(f.id)
            : interaction.fields.getSelectedUsers(f.id);
      const members = o.type === OPTION.USER ? interaction.fields.getSelectedMembers(f.id) : null;
      [...(picked?.values() ?? [])].forEach((item, i) => {
        if (!f.names[i]) return;
        values[f.names[i]] = item;
        if (members?.get(item.id)) values[`${f.names[i]}:member`] = members.get(item.id);
      });
    } else if (o.type === OPTION.ATTACHMENT) {
      const file = interaction.fields.getUploadedFiles(f.id)?.first();
      if (file) values[o.name] = file;
    } else if (o.type === OPTION.BOOLEAN || o.choices?.length) {
      const raw = interaction.fields.getStringSelectValues(f.id)?.[0];
      if (raw !== undefined) values[o.name] = o.type === OPTION.BOOLEAN ? raw === 'true' : number ? Number(raw) : raw;
    } else {
      const raw = interaction.fields.getTextInputValue(f.id).trim();
      if (!raw) continue;
      if (!number) {
        values[o.name] = raw;
        continue;
      }
      const parts = raw.split(/[\s,;]+/).filter(Boolean);
      if (parts.length > f.names.length) return { error: `${pretty(f)} : ${f.names.length} nombre(s) au plus.` };
      for (const [i, part] of parts.entries()) {
        const n = Number(part.replace(/\s/g, ''));
        if (!Number.isFinite(n) || (o.type === OPTION.INTEGER && !Number.isInteger(n))) return { error: `${pretty(f)} : « ${part} » n’est pas un nombre entier.` };
        if ((o.min_value != null && n < o.min_value) || (o.max_value != null && n > o.max_value)) {
          return { error: `${pretty(f)} : ${n} doit être entre ${o.min_value ?? '…'} et ${o.max_value ?? '…'}.` };
        }
        values[f.names[i]] = n;
      }
    }
  }
  return { values };
}

// L'interaction du panneau, vue par l'ancienne commande comme une commande slash avec ses options.
function asCommand(interaction, sub, values) {
  const get = (name, required = false) => {
    const value = values[name];
    if (value === undefined || value === null) {
      if (required) throw new Error(`Information manquante : ${name}`);
      return null;
    }
    return value;
  };
  const options = {
    getSubcommand: (required = true) => {
      if (!sub && required) throw new Error('Sous-commande manquante');
      return sub;
    },
    getSubcommandGroup: () => null,
    getString: get,
    getInteger: get,
    getNumber: get,
    getBoolean: get,
    getChannel: get,
    getRole: get,
    getUser: get,
    getMentionable: get,
    getAttachment: get,
    getMember: (name) => values[`${name}:member`] ?? null,
  };
  return new Proxy(interaction, {
    get(target, prop) {
      if (prop === 'options') return options;
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

// --- Lancer une action ---

const PAGE = 5; // champs par formulaire (limite de Discord)
const pending = new Map(); // `${userId}:${clé}:${action}` → { values, at } : page 1 d'un formulaire en deux pages
const PENDING_MS = 10 * 60_000;

function settingsModal(e, action, fields, page) {
  const pages = Math.ceil(fields.length / PAGE);
  const title = `${e.label} — ${action.label}${pages > 1 ? ` (${page + 1}/${pages})` : ''}`;
  return new ModalBuilder()
    .setCustomId(`cfgp:modal:${e.key}:${action.id}:${page}`)
    .setTitle(title.slice(0, 45))
    .addLabelComponents(fields.slice(page * PAGE, (page + 1) * PAGE).map(fieldComponent));
}

async function execute(interaction, action, values) {
  try {
    await action.mod.execute(asCommand(interaction, action.sub, values));
  } catch (err) {
    console.error('[config]', err);
    const reply = { content: `❌ Le réglage a échoué : ${err.message}`, ephemeral: true };
    await (interaction.replied || interaction.deferred ? interaction.followUp(reply) : interaction.reply(reply)).catch(() => {});
  }
}

function missingPermission(interaction, action) {
  const needed = action.mod.data.toJSON().default_member_permissions;
  if (!needed || interaction.memberPermissions?.has(BigInt(needed))) return null;
  return `❌ Il te faut la permission **${new PermissionsBitField(BigInt(needed)).toArray().join(', ')}** pour ce réglage.`;
}

export async function handleConfigPanel(interaction) {
  const [, kind, key, actionId, page] = interaction.customId.split(':');
  const { guild } = interaction;
  if (kind === 'home') return interaction.update(configHome(guild));
  const e = byKey.get(key);
  if (!e) return interaction.update(configHome(guild, '❌ Ce système n’existe plus.'));
  if (kind === 'open') return interaction.update(entryView(guild, e));
  const action = actionsOf(e).find((a) => a.id === actionId);
  if (!action) return interaction.update(entryView(guild, e));
  const problem = missingPermission(interaction, action);
  if (problem) return interaction.reply({ content: problem, ephemeral: true });
  const fields = fieldsOf(action.options);

  if (kind === 'run') {
    if (!fields.length) return execute(interaction, action, {});
    // Un seul salon / rôle / membre à choisir : un menu dans le panneau.
    const only = fields.length === 1 && fields[0].names.length === 1 && SELECTS.includes(fields[0].type) ? fields[0] : null;
    if (only) {
      const o = only.option;
      const select =
        o.type === OPTION.CHANNEL
          ? new ChannelSelectMenuBuilder().setCustomId(`cfgp:pick:${e.key}:${action.id}`).addChannelTypes(...(o.channel_types ?? []))
          : o.type === OPTION.ROLE
            ? new RoleSelectMenuBuilder().setCustomId(`cfgp:pick:${e.key}:${action.id}`)
            : new UserSelectMenuBuilder().setCustomId(`cfgp:pick:${e.key}:${action.id}`);
      select.setPlaceholder(`${pretty(only)} : ${o.description}`.slice(0, 150));
      const view = entryView(guild, e, `👇 **${action.label}** — choisis ci-dessous.`);
      view.components.splice(view.components.length - 1, 0, new ActionRowBuilder().addComponents(select));
      return interaction.update(view);
    }
    return interaction.showModal(settingsModal(e, action, fields, 0));
  }

  if (kind === 'pick') {
    const name = fields[0].names[0];
    const item = interaction.channels?.first() ?? interaction.roles?.first() ?? interaction.users?.first();
    const values = { [name]: item };
    if (interaction.members?.first()) values[`${name}:member`] = interaction.members.first();
    return execute(interaction, action, values);
  }

  const id = `${interaction.user.id}:${e.key}:${action.id}`;
  if (kind === 'next') return interaction.showModal(settingsModal(e, action, fields, Number(page)));

  if (kind === 'modal') {
    const current = Number(page);
    const { values, error } = readFields(interaction, fields.slice(current * PAGE, (current + 1) * PAGE));
    if (error) return interaction.reply({ content: `❌ ${error}`, ephemeral: true });
    const saved = current > 0 && Date.now() - (pending.get(id)?.at ?? 0) < PENDING_MS ? pending.get(id).values : {};
    const all = { ...saved, ...values };
    if ((current + 1) * PAGE < fields.length) {
      pending.set(id, { values: all, at: Date.now() });
      return interaction.reply({
        content: `📝 **${e.label} — ${action.label}** : page ${current + 1} enregistrée.`,
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`cfgp:next:${e.key}:${action.id}:${current + 1}`).setLabel(`Continuer (${current + 2}/${Math.ceil(fields.length / PAGE)})`).setStyle(ButtonStyle.Primary),
          ),
        ],
        ephemeral: true,
      });
    }
    pending.delete(id);
    return execute(interaction, action, all);
  }
}
