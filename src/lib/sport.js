import {
  AttachmentBuilder,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} from 'discord.js';
import { createCanvas } from '@napi-rs/canvas';
import { getGuildConfig, setGuildConfig } from './store.js';
import { font, fetchImage } from './fonts.js';

// Sport (/config → Sport) : deux salons, un message par match (football) ou par combat (UFC), avec une image
// « club vs club » ou « combattant vs combattant ». Le message est posté la veille du match (2 jours avant un
// événement UFC), affiche le score en direct pendant le match, puis est remplacé par le résultat (reposté en bas
// du salon, avec le score ou le vainqueur sur l'image). Données : l'API publique d'ESPN (sans clé), lue toutes
// les 10 min. Réglages : data[guildId].sport = { footballChannelId, ufcChannelId, leagues, version,
// posted: ['fb:<match>' | 'ufcf:<combat>'] (résultats déjà postés), announced: { clé: { messageId, channelId, live, at } } }.

export const LEAGUES = {
  'fra.1': 'Ligue 1',
  'uefa.champions': 'Ligue des champions',
  'uefa.europa': 'Ligue Europa',
  'eng.1': 'Premier League',
  'esp.1': 'Liga',
  'ita.1': 'Serie A',
  'ger.1': 'Bundesliga',
};
const DEFAULT_LEAGUES = ['fra.1', 'uefa.champions'];
export const SPORT_POLL_MS = 10 * 60_000;
const VERSION = 2; // un message par match / combat
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const DAY = 86_400_000;
const FOOTBALL_AHEAD = DAY; // annonce la veille
const UFC_AHEAD = 2 * DAY; // annonce 2 jours avant l'événement
const MAX_POSTED = 600;
const FOOTBALL_COLOR = 0x1f8b4c;
const UFC_COLOR = 0xd20a0a;
const METHODS = { kotko: 'KO / TKO', ko: 'KO', tko: 'TKO', decision: 'décision', submission: 'soumission', dq: 'disqualification' };
const WEIGHTS = {
  strawweight: 'poids pailles',
  flyweight: 'poids mouches',
  bantamweight: 'poids coqs',
  featherweight: 'poids plumes',
  lightweight: 'poids légers',
  welterweight: 'poids mi-moyens',
  middleweight: 'poids moyens',
  'light heavyweight': 'poids mi-lourds',
  heavyweight: 'poids lourds',
  catchweight: 'poids intermédiaire',
};

// Équipes nationales : leurs matchs dans ces compétitions sont postés (seulement ceux des équipes choisies).
const NATIONAL_COMPETITIONS = {
  'fifa.world': 'Coupe du monde',
  'fifa.worldq.uefa': 'Qualifications Coupe du monde (Europe)',
  'fifa.worldq.caf': 'Qualifications Coupe du monde (Afrique)',
  'fifa.worldq.conmebol': 'Qualifications Coupe du monde (Amérique du Sud)',
  'fifa.worldq.concacaf': 'Qualifications Coupe du monde (Concacaf)',
  'fifa.worldq.afc': 'Qualifications Coupe du monde (Asie)',
  'uefa.euro': 'Euro',
  'uefa.euroq': 'Qualifications Euro',
  'uefa.nations': 'Ligue des nations',
  'caf.nations': 'Coupe d’Afrique des nations',
  'caf.nations_qual': 'Qualifications CAN',
  'conmebol.america': 'Copa América',
  'fifa.friendly': 'Match amical',
};
// [nom chez ESPN, nom affiché, drapeau] : les 25 au plus proposées dans le formulaire.
const NATIONAL_TEAMS = [
  ['Morocco', 'Maroc', '🇲🇦'], ['France', 'France', '🇫🇷'], ['Algeria', 'Algérie', '🇩🇿'], ['Tunisia', 'Tunisie', '🇹🇳'],
  ['Senegal', 'Sénégal', '🇸🇳'], ['Ivory Coast', 'Côte d’Ivoire', '🇨🇮'], ['Cameroon', 'Cameroun', '🇨🇲'], ['Mali', 'Mali', '🇲🇱'],
  ['DR Congo', 'RD Congo', '🇨🇩'], ['Egypt', 'Égypte', '🇪🇬'], ['Nigeria', 'Nigeria', '🇳🇬'], ['Belgium', 'Belgique', '🇧🇪'],
  ['Switzerland', 'Suisse', '🇨🇭'], ['Portugal', 'Portugal', '🇵🇹'], ['Spain', 'Espagne', '🇪🇸'], ['Italy', 'Italie', '🇮🇹'],
  ['Germany', 'Allemagne', '🇩🇪'], ['England', 'Angleterre', '🏴󠁧󠁢󠁥󠁮󠁧󠁿'], ['Netherlands', 'Pays-Bas', '🇳🇱'], ['Turkey', 'Turquie', '🇹🇷'],
  ['Brazil', 'Brésil', '🇧🇷'], ['Argentina', 'Argentine', '🇦🇷'], ['United States', 'États-Unis', '🇺🇸'], ['Japan', 'Japon', '🇯🇵'],
  ['Comoros', 'Comores', '🇰🇲'],
];
const DEFAULT_NATIONAL = ['Morocco', 'France'];
// Noms des pays en français dans les messages (les clubs gardent le nom donné par ESPN).
const FR_NAMES = Object.fromEntries(NATIONAL_TEAMS.map(([en, fr]) => [en, fr]));
Object.assign(FR_NAMES, { Niger: 'Niger', Gabon: 'Gabon', Ghana: 'Ghana', Libya: 'Libye', Mauritania: 'Mauritanie', Zambia: 'Zambie', 'South Africa': 'Afrique du Sud', Sweden: 'Suède', Denmark: 'Danemark', Croatia: 'Croatie', Poland: 'Pologne', Austria: 'Autriche', Mexico: 'Mexique', Uruguay: 'Uruguay', Colombia: 'Colombie' });
const competitionName = (league) => LEAGUES[league] ?? NATIONAL_COMPETITIONS[league] ?? league;

export function getSportConfig(guildId) {
  return { leagues: DEFAULT_LEAGUES, nationalTeams: DEFAULT_NATIONAL, posted: [], announced: {}, ...(getGuildConfig(guildId).sport ?? {}) };
}

function patchSport(guildId, patch) {
  setGuildConfig(guildId, { sport: { ...getSportConfig(guildId), ...patch } });
}

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');
const unix = (iso) => Math.floor(Date.parse(iso) / 1000);

// Réponses d'ESPN gardées le temps d'une mise à jour (plusieurs serveurs peuvent suivre la même compétition).
async function fetchJson(url, cache) {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url, { signal: AbortSignal.timeout(15_000) })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    );
  }
  return cache.get(url);
}

// --- Image « A vs B » (ou avec le score / le vainqueur) ---

const W = 960;
const H = 400;
const THEMES = { football: ['#0d4a2c', '#04140c'], ufc: ['#4a0b0b', '#120303'] };

function drawContain(ctx, img, cx, cy, size) {
  const ratio = Math.min(size / img.width, size / img.height);
  const w = img.width * ratio;
  const h = img.height * ratio;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
}

const initials = (name) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();

// sides : [{ name, images: [url, url de secours] }, …] ; center : « VS » ou le score ; winner : 0, 1 ou null.
async function versusImage(theme, sides, center, winner = null) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const [top, bottom] = THEMES[theme];
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, top);
  bg.addColorStop(1, bottom);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, 260);
  glow.addColorStop(0, 'rgba(255,255,255,0.12)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  for (const [i, side] of sides.entries()) {
    const x = i === 0 ? 215 : W - 215;
    let img = null;
    for (const url of side.images.filter(Boolean)) if ((img = await fetchImage(url))) break;
    ctx.globalAlpha = winner !== null && winner !== i ? 0.35 : 1;
    if (img) drawContain(ctx, img, x, 165, theme === 'ufc' ? 270 : 220);
    else {
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.arc(x, 165, 100, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = font(64, { bold: true });
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(initials(side.name), x, 165);
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = font(30, { bold: true });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(side.name, x, 335, 380);
    if (winner === i) {
      ctx.fillStyle = '#f5c542';
      ctx.font = font(22, { bold: true });
      ctx.fillText('VAINQUEUR', x, 372);
    }
    ctx.globalAlpha = 1;
  }

  ctx.fillStyle = '#ffffff';
  ctx.font = font(center === 'VS' ? 88 : 76, { bold: true });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(center, W / 2, 170);
  return new AttachmentBuilder(await canvas.encode('png'), { name: 'match.png' });
}

// --- Football ---

// Matchs d'hier à demain (ESPN ne donne qu'un jour par requête pour le football).
async function footballEvents(league, cache) {
  const events = new Map();
  for (let d = -1; d <= 1; d++) {
    const data = await fetchJson(`${ESPN}/soccer/${league}/scoreboard?dates=${ymd(Date.now() + d * DAY)}`, cache);
    for (const e of data?.events ?? []) events.set(e.id, e);
  }
  return [...events.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

function footballSides(e) {
  const teams = e.competitions?.[0]?.competitors ?? [];
  const home = teams.find((t) => t.homeAway === 'home') ?? teams[0];
  const away = teams.find((t) => t.homeAway === 'away') ?? teams[1];
  return [home, away].map((t) => ({ team: t, name: FR_NAMES[t?.team?.displayName] ?? t?.team?.displayName ?? '?', images: [t?.team?.logo] }));
}

async function footballMessage(league, e, phase) {
  const sides = footballSides(e);
  const [home, away] = sides;
  const venue = e.competitions?.[0]?.venue?.fullName;
  const score = `${home.team?.score ?? 0} - ${away.team?.score ?? 0}`;
  const embed = new EmbedBuilder().setColor(FOOTBALL_COLOR).setImage('attachment://match.png');
  let center = 'VS';
  let winner = null;
  if (phase === 'final') {
    winner = home.team?.winner ? 0 : away.team?.winner ? 1 : null;
    center = score;
    embed
      .setAuthor({ name: `⚽ ${competitionName(league)} — résultat` })
      .setTitle(`${home.name} ${score} ${away.name}`.slice(0, 256))
      .setDescription(
        [winner === null ? '🤝 Match nul' : `🏆 Victoire de **${sides[winner].name}**`, `📅 <t:${unix(e.date)}:F>`, venue ? `🏟️ ${venue}` : null]
          .filter(Boolean)
          .join('\n'),
      );
  } else {
    embed
      .setAuthor({ name: `⚽ ${competitionName(league)}` })
      .setTitle(`${home.name} vs ${away.name}`.slice(0, 256))
      .setDescription(
        [
          phase === 'live' ? `🔴 **En direct : ${score}** (${e.status?.type?.shortDetail ?? ''})` : null,
          `📅 Coup d’envoi <t:${unix(e.date)}:F> (<t:${unix(e.date)}:R>)`,
          venue ? `🏟️ ${venue}` : null,
        ]
          .filter(Boolean)
          .join('\n'),
      );
  }
  return { embed, image: () => versusImage('football', sides, center, winner) };
}

// --- UFC ---

function ufcSides(fight) {
  return (fight.competitors ?? []).slice(0, 2).map((c) => ({
    competitor: c,
    name: c.athlete?.displayName ?? '?',
    images: [`https://a.espncdn.com/i/headshots/mma/players/full/${c.id}.png`, c.athlete?.flag?.href],
  }));
}

function weightOf(fight) {
  const raw = fight.type?.abbreviation ?? fight.type?.text ?? '';
  const women = /women'?s|^w\s/i.test(raw); // « Women's Flyweight » ou « W Flyweight »
  const key = raw.replace(/women'?s|^w\s+/i, '').trim().toLowerCase();
  return WEIGHTS[key] ? `${WEIGHTS[key]}${women ? ' (F)' : ''}` : raw;
}

function methodOf(fight) {
  const text = (fight.details ?? []).map((d) => d.type?.text ?? '').find((t) => /^unofficial winner/i.test(t));
  const key = text?.replace(/^unofficial winner\s*/i, '').trim().toLowerCase();
  return key ? (METHODS[key] ?? key) : null;
}

async function ufcMessage(event, fight, main, phase) {
  const sides = ufcSides(fight);
  const [a, b] = sides;
  const weight = weightOf(fight);
  const embed = new EmbedBuilder().setColor(UFC_COLOR).setImage('attachment://match.png');
  let winner = null;
  if (phase === 'final') {
    winner = a.competitor?.winner ? 0 : b.competitor?.winner ? 1 : null;
    const method = methodOf(fight);
    embed
      .setAuthor({ name: `🥊 ${event.name} — résultat`.slice(0, 256) })
      .setTitle(winner === null ? `${a.name} vs ${b.name} : pas de vainqueur` : `🏆 ${sides[winner].name} bat ${sides[1 - winner].name}`.slice(0, 256))
      .setDescription([method ? `Par **${method}**` : null, weight ? `⚖️ ${weight}` : null, main ? '⭐ Combat principal' : null].filter(Boolean).join('\n') || null);
  } else {
    const when = fight.date ?? event.date;
    embed
      .setAuthor({ name: `🥊 ${event.name}`.slice(0, 256) })
      .setTitle(`${a.name} vs ${b.name}`.slice(0, 256))
      .setDescription(
        [
          main ? '⭐ **Combat principal**' : null,
          phase === 'live' ? '🔴 **Combat en cours**' : null,
          weight ? `⚖️ ${weight}` : null,
          `📅 <t:${unix(when)}:F> (<t:${unix(when)}:R>)`,
        ]
          .filter(Boolean)
          .join('\n'),
      );
  }
  return { embed, image: () => versusImage('ufc', sides, 'VS', winner) };
}

// --- Messages : annonce (avec score en direct), puis résultat à la place ---

async function textChannel(guild, id) {
  const channel = id && (guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null)));
  return channel?.isTextBased() ? channel : null;
}

async function sendWithImage(channel, msg) {
  const file = await msg.image().catch(() => null);
  const embed = file ? msg.embed : msg.embed.setImage(null);
  return channel.send({ embeds: [embed], files: file ? [file] : [], allowedMentions: { parse: [] } }).catch(() => null);
}

// Un match ou un combat : annoncé (une fois), score en direct dans le même message, puis résultat à sa place.
async function track(ctx, key, phase, build) {
  const { guild, channel, state, seeding } = ctx;
  const known = state.announced[key];
  if (phase === 'final') {
    if (state.posted.has(key)) return;
    state.posted.add(key);
    if (seeding) return; // résultats d'avant l'activation : pas de déluge de messages
    if (known) {
      const old = await textChannel(guild, known.channelId);
      await old?.messages.delete(known.messageId).catch(() => {});
      delete state.announced[key];
    }
    await sendWithImage(channel, await build('final'));
    return;
  }
  if (!known) {
    const sent = await sendWithImage(channel, await build(phase));
    if (sent) state.announced[key] = { messageId: sent.id, channelId: channel.id, live: phase === 'live' ? sent.embeds[0]?.description : null, at: Date.now() };
    return;
  }
  if (phase === 'live') {
    // Score en direct : seul le texte change (l'image « vs » reste).
    const { embed } = await build('live');
    const text = embed.toJSON().description;
    if (text === known.live) return;
    const old = await textChannel(guild, known.channelId);
    if (await old?.messages.edit(known.messageId, { embeds: [embed] }).catch(() => null)) known.live = text;
  }
}

// Fini → résultat ; en cours → direct ; à venir dans la fenêtre → annonce. Reporté ou annulé (« post » sans être
// terminé) : rien.
function phaseOf(status, soon) {
  if (status?.completed) return 'final';
  if (status?.state === 'in') return 'live';
  return status?.state === 'pre' && soon ? 'soon' : null;
}

async function updateFootball(ctx, cfg, cache) {
  const now = Date.now();
  const follow = async (league, keep = () => true) => {
    for (const e of await footballEvents(league, cache)) {
      if (!keep(e)) continue;
      const phase = phaseOf(e.status?.type, Date.parse(e.date) - now <= FOOTBALL_AHEAD);
      if (phase) await track(ctx, `fb:${e.id}`, phase, (p) => footballMessage(league, e, p));
    }
  };
  for (const league of cfg.leagues) await follow(league);
  // Équipes nationales : seulement les matchs où joue une équipe choisie.
  const teams = new Set(cfg.nationalTeams ?? []);
  if (!teams.size) return;
  const plays = (e) => (e.competitions?.[0]?.competitors ?? []).some((c) => teams.has(c.team?.displayName));
  for (const league of Object.keys(NATIONAL_COMPETITIONS)) await follow(league, plays);
}

async function updateUfc(ctx, cache) {
  const now = Date.now();
  const data = await fetchJson(`${ESPN}/mma/ufc/scoreboard?dates=${ymd(now - 3 * DAY)}-${ymd(now + 30 * DAY)}`, cache);
  for (const event of (data?.events ?? []).sort((a, b) => Date.parse(a.date) - Date.parse(b.date))) {
    const soon = Date.parse(event.date) - now <= UFC_AHEAD;
    const fights = event.competitions ?? []; // du premier combat au combat principal (posté en dernier)
    for (const [i, fight] of fights.entries()) {
      const state = fight.status?.type;
      const phase = phaseOf(state, soon);
      if (phase) await track(ctx, `ufcf:${fight.id}`, phase, (p) => ufcMessage(event, fight, i === fights.length - 1, p));
    }
  }
}

export async function refreshSport(guild, cache = new Map()) {
  const cfg = getSportConfig(guild.id);
  if (!cfg.footballChannelId && !cfg.ufcChannelId) return;
  // Première fois (activation, ou passage à « un message par match ») : les résultats déjà connus ne sont pas
  // postés, et les anciens tableaux récapitulatifs sont retirés.
  const seeding = cfg.version !== VERSION;
  if (seeding) {
    for (const [board, channelId] of [[cfg.footballBoard, cfg.footballChannelId], [cfg.ufcBoard, cfg.ufcChannelId]]) {
      if (board?.messageId) await (await textChannel(guild, channelId))?.messages.delete(board.messageId).catch(() => {});
    }
  }
  // Annonces de plus de 3 jours (match reporté, combat annulé…) : oubliées.
  const announced = Object.fromEntries(Object.entries(cfg.announced ?? {}).filter(([, a]) => Date.now() - (a.at ?? 0) < 3 * DAY));
  const state = { posted: new Set(cfg.posted), announced };
  const football = await textChannel(guild, cfg.footballChannelId);
  if (football) await updateFootball({ guild, channel: football, state, seeding }, cfg, cache);
  const ufc = await textChannel(guild, cfg.ufcChannelId);
  if (ufc) await updateUfc({ guild, channel: ufc, state, seeding }, cache);
  patchSport(guild.id, {
    posted: [...state.posted].slice(-MAX_POSTED),
    announced: state.announced,
    version: VERSION,
    footballBoard: null,
    ufcBoard: null,
  });
}

// Toutes les 10 min (ready.js) : chaque serveur qui suit du sport.
export async function pollSport(client) {
  const cache = new Map();
  for (const guild of client.guilds.cache.values()) {
    await refreshSport(guild, cache).catch((err) => console.error('[sport]', err.message));
  }
}

// --- Réglages (/config → Sport) ---

export function sportModal(guildId) {
  const cfg = getSportConfig(guildId);
  const channel = (id, current) => {
    const select = new ChannelSelectMenuBuilder()
      .setCustomId(id)
      .setRequired(false)
      .setMinValues(0)
      .setMaxValues(1)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);
    if (current) select.setDefaultChannels(current);
    return select;
  };
  const leagues = new StringSelectMenuBuilder()
    .setCustomId('leagues')
    .setRequired(false)
    .setMinValues(0)
    .setMaxValues(Object.keys(LEAGUES).length)
    .addOptions(Object.entries(LEAGUES).map(([value, label]) => ({ label, value, default: cfg.leagues.includes(value) })));
  const nations = new StringSelectMenuBuilder()
    .setCustomId('nations')
    .setRequired(false)
    .setMinValues(0)
    .setMaxValues(NATIONAL_TEAMS.length)
    .addOptions(NATIONAL_TEAMS.map(([value, label, emoji]) => ({ label, value, emoji, default: (cfg.nationalTeams ?? []).includes(value) })));
  return new ModalBuilder()
    .setCustomId('sport:modal')
    .setTitle('Sport')
    .addLabelComponents(
      new LabelBuilder().setLabel('Salon football').setDescription('Un message par match (vide = désactivé)').setChannelSelectMenuComponent(channel('football', cfg.footballChannelId)),
      new LabelBuilder().setLabel('Compétitions de clubs').setDescription('Celles dont les matchs sont postés').setStringSelectMenuComponent(leagues),
      new LabelBuilder()
        .setLabel('Équipes nationales')
        .setDescription('Leurs matchs : Coupe du monde, Euro, CAN, qualifications, amicaux…')
        .setStringSelectMenuComponent(nations),
      new LabelBuilder().setLabel('Salon UFC').setDescription('Un message par combat (vide = désactivé)').setChannelSelectMenuComponent(channel('ufc', cfg.ufcChannelId)),
    );
}

export async function handleSportInteraction(interaction) {
  if (interaction.customId !== 'sport:modal') return;
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '❌ Il te faut la permission **Gérer le serveur**.', ephemeral: true });
  }
  const { guild } = interaction;
  const football = interaction.fields.getSelectedChannels('football')?.first() ?? null;
  const ufc = interaction.fields.getSelectedChannels('ufc')?.first() ?? null;
  const picked = interaction.fields.getStringSelectValues('leagues') ?? [];
  const nationalTeams = interaction.fields.getStringSelectValues('nations') ?? [];
  // Rien de coché du tout : les compétitions par défaut (sinon le salon football ne recevrait rien).
  const leagues = picked.length || nationalTeams.length ? picked : DEFAULT_LEAGUES;
  patchSport(guild.id, { footballChannelId: football?.id ?? null, ufcChannelId: ufc?.id ?? null, leagues, nationalTeams });
  const followed = [
    ...leagues.map((l) => LEAGUES[l]),
    ...(nationalTeams.length ? [`équipes nationales : ${nationalTeams.map((t) => FR_NAMES[t] ?? t).join(', ')}`] : []),
  ];
  const lines = [
    football ? `⚽ **Football** dans ${football} : ${followed.join(', ')}` : '⚽ Football : désactivé',
    ufc ? `🥊 **UFC** dans ${ufc}` : '🥊 UFC : désactivé',
  ];
  await interaction.reply({
    content:
      lines.join('\n') +
      (football || ufc
        ? '\n-# Chaque match est annoncé la veille (2 jours avant pour l’UFC) avec son image, puis remplacé par son résultat. Vérifié toutes les 10 min.'
        : ''),
    ephemeral: true,
  });
  await refreshSport(guild).catch((err) => console.error('[sport]', err.message));
}
