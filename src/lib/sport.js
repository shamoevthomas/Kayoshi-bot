import { ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, LabelBuilder, ModalBuilder, PermissionFlagsBits, StringSelectMenuBuilder } from 'discord.js';
import { getGuildConfig, setGuildConfig } from './store.js';

// Sport (/config → Sport) : deux salons. Football : le résultat de chaque match terminé des compétitions choisies,
// et un tableau « Matchs à venir » (7 jours) toujours reposté en bas du salon quand il change. UFC : les résultats
// de chaque événement terminé et la carte du prochain événement, tenue à jour en bas du salon de la même façon.
// Données : l'API publique d'ESPN (sans clé), lue toutes les 30 min. Réglages : data[guildId].sport =
// { footballChannelId, ufcChannelId, leagues, posted: ['fb:<id>' | 'ufc:<id>'], footballBoard, ufcBoard }.

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
export const SPORT_POLL_MS = 30 * 60_000;
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const MAX_POSTED = 400;
const FOOTBALL_COLOR = 0x1f8b4c;
const UFC_COLOR = 0xd20a0a;
const METHODS = { kotko: 'KO / TKO', ko: 'KO', tko: 'TKO', decision: 'décision', submission: 'soumission', dq: 'disqualification' };

export function getSportConfig(guildId) {
  return { leagues: DEFAULT_LEAGUES, posted: [], ...(getGuildConfig(guildId).sport ?? {}) };
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

// --- Football ---

// Matchs d'hier à J+7 (ESPN ne donne qu'un jour par requête pour le football).
async function footballEvents(league, cache) {
  const events = new Map();
  for (let d = -1; d <= 7; d++) {
    const data = await fetchJson(`${ESPN}/soccer/${league}/scoreboard?dates=${ymd(Date.now() + d * 86_400_000)}`, cache);
    for (const e of data?.events ?? []) events.set(e.id, e);
  }
  return [...events.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

const sides = (e) => {
  const teams = e.competitions?.[0]?.competitors ?? [];
  return { home: teams.find((t) => t.homeAway === 'home') ?? teams[0], away: teams.find((t) => t.homeAway === 'away') ?? teams[1] };
};

function resultEmbed(league, e) {
  const { home, away } = sides(e);
  const winner = home?.winner ? home : away?.winner ? away : null;
  const venue = e.competitions?.[0]?.venue?.fullName;
  const embed = new EmbedBuilder()
    .setColor(FOOTBALL_COLOR)
    .setAuthor({ name: `⚽ ${LEAGUES[league] ?? league} — résultat` })
    .setTitle(`${home?.team?.displayName} ${home?.score ?? '?'} - ${away?.score ?? '?'} ${away?.team?.displayName}`.slice(0, 256))
    .setDescription(
      [winner ? `🏆 Victoire de **${winner.team.displayName}**` : '🤝 Match nul', `📅 <t:${unix(e.date)}:F>`, venue ? `🏟️ ${venue}` : null]
        .filter(Boolean)
        .join('\n'),
    );
  const logo = winner?.team?.logo ?? home?.team?.logo;
  if (logo) embed.setThumbnail(logo);
  return embed;
}

function footballBoard(byLeague) {
  const embed = new EmbedBuilder().setColor(FOOTBALL_COLOR).setTitle('📅 Matchs à venir (7 jours)');
  let any = false;
  for (const [league, events] of byLeague) {
    if (!events.length) continue;
    any = true;
    let value = '';
    for (const e of events) {
      const { home, away } = sides(e);
      const line = `<t:${unix(e.date)}:f> · **${home?.team?.displayName}** – **${away?.team?.displayName}**\n`;
      if (value.length + line.length > 1000) {
        value += '…';
        break;
      }
      value += line;
    }
    embed.addFields({ name: `⚽ ${LEAGUES[league] ?? league}`, value });
  }
  if (!any) embed.setDescription('Aucun match dans les 7 prochains jours pour les compétitions suivies.');
  return embed.setFooter({ text: 'Mis à jour toutes les 30 min · heures dans ton fuseau' });
}

// --- UFC ---

const fightersOf = (fight) => (fight.competitors ?? []).map((c) => ({ name: c.athlete?.displayName ?? '?', winner: Boolean(c.winner) }));
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
// « Women's Flyweight » → « poids mouches (F) » ; une catégorie inconnue reste en anglais.
function weightOf(fight) {
  const raw = fight.type?.abbreviation ?? fight.type?.text ?? '';
  const women = /women'?s/i.test(raw);
  const key = raw.replace(/women'?s/i, '').trim().toLowerCase();
  return WEIGHTS[key] ? `${WEIGHTS[key]}${women ? ' (F)' : ''}` : raw;
}

function methodOf(fight) {
  const text = (fight.details ?? []).map((d) => d.type?.text ?? '').find((t) => /^unofficial winner/i.test(t));
  const key = text?.replace(/^unofficial winner\s*/i, '').trim().toLowerCase();
  return key ? (METHODS[key] ?? key) : null;
}

function ufcCard(e) {
  // ESPN liste les combats du premier au main event : le main event en premier ici.
  const fights = [...(e.competitions ?? [])].reverse();
  const lines = fights.map((f, i) => {
    const [a, b] = fightersOf(f);
    return `${i === 0 ? '⭐' : '•'} **${a?.name}** vs **${b?.name}**${weightOf(f) ? ` · ${weightOf(f)}` : ''}`;
  });
  return new EmbedBuilder()
    .setColor(UFC_COLOR)
    .setAuthor({ name: '🥊 Prochain événement UFC' })
    .setTitle(e.name.slice(0, 256))
    .setDescription(`📅 <t:${unix(e.date)}:F> (<t:${unix(e.date)}:R>)\n\n${lines.join('\n')}`.slice(0, 4000))
    .setFooter({ text: 'Mis à jour toutes les 30 min · heures dans ton fuseau' });
}

function ufcResults(e) {
  const fights = [...(e.competitions ?? [])].reverse();
  const lines = fights.map((f, i) => {
    const [a, b] = fightersOf(f);
    const winner = a?.winner ? a : b?.winner ? b : null;
    const loser = winner === a ? b : a;
    const method = methodOf(f);
    const head = i === 0 ? '⭐' : '•';
    return winner
      ? `${head} 🏆 **${winner.name}** bat ${loser?.name}${method ? ` (${method})` : ''}`
      : `${head} **${a?.name}** vs **${b?.name}** : pas de vainqueur (nul ou no contest)`;
  });
  return new EmbedBuilder()
    .setColor(UFC_COLOR)
    .setAuthor({ name: '🥊 UFC — résultats' })
    .setTitle(e.name.slice(0, 256))
    .setDescription(`📅 <t:${unix(e.date)}:D>\n\n${lines.join('\n')}`.slice(0, 4000));
}

// --- Mise à jour d'un serveur ---

async function textChannel(guild, id) {
  const channel = id && (guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null)));
  return channel?.isTextBased() ? channel : null;
}

// Tableau en bas du salon : reposté (l'ancien supprimé) quand il change ou qu'un résultat vient d'être posté.
async function updateBoard(channel, board, embed, force) {
  const text = JSON.stringify(embed.toJSON().fields ?? embed.toJSON().description);
  if (!force && board?.text === text) return board;
  if (board?.messageId) await channel.messages.delete(board.messageId).catch(() => {});
  const sent = await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => null);
  return sent ? { messageId: sent.id, text } : board;
}

async function updateFootball(guild, cfg, cache, posted) {
  const channel = await textChannel(guild, cfg.footballChannelId);
  if (!channel) return cfg.footballBoard;
  let newResults = 0;
  const byLeague = [];
  for (const league of cfg.leagues) {
    const events = await footballEvents(league, cache);
    for (const e of events.filter((ev) => ev.status?.type?.completed)) {
      if (posted.has(`fb:${e.id}`)) continue;
      posted.add(`fb:${e.id}`);
      if (await channel.send({ embeds: [resultEmbed(league, e)], allowedMentions: { parse: [] } }).catch(() => null)) newResults++;
    }
    byLeague.push([league, events.filter((ev) => ev.status?.type?.state === 'pre')]);
  }
  return updateBoard(channel, cfg.footballBoard, footballBoard(byLeague), newResults > 0);
}

async function updateUfc(guild, cfg, cache, posted) {
  const channel = await textChannel(guild, cfg.ufcChannelId);
  if (!channel) return cfg.ufcBoard;
  const data = await fetchJson(`${ESPN}/mma/ufc/scoreboard?dates=${ymd(Date.now() - 3 * 86_400_000)}-${ymd(Date.now() + 45 * 86_400_000)}`, cache);
  const events = (data?.events ?? []).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  let newResults = 0;
  for (const e of events.filter((ev) => ev.status?.type?.completed)) {
    if (posted.has(`ufc:${e.id}`)) continue;
    posted.add(`ufc:${e.id}`);
    if (await channel.send({ embeds: [ufcResults(e)], allowedMentions: { parse: [] } }).catch(() => null)) newResults++;
  }
  const next = events.find((ev) => ev.status?.type?.state === 'pre');
  if (!next) return cfg.ufcBoard;
  return updateBoard(channel, cfg.ufcBoard, ufcCard(next), newResults > 0);
}

export async function refreshSport(guild, cache = new Map()) {
  const cfg = getSportConfig(guild.id);
  if (!cfg.footballChannelId && !cfg.ufcChannelId) return;
  const posted = new Set(cfg.posted);
  const footballBoard = cfg.footballChannelId ? await updateFootball(guild, cfg, cache, posted) : cfg.footballBoard;
  const ufcBoard = cfg.ufcChannelId ? await updateUfc(guild, cfg, cache, posted) : cfg.ufcBoard;
  patchSport(guild.id, { posted: [...posted].slice(-MAX_POSTED), footballBoard, ufcBoard });
}

// Toutes les 30 min (ready.js) : chaque serveur qui suit du sport.
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
  return new ModalBuilder()
    .setCustomId('sport:modal')
    .setTitle('Sport')
    .addLabelComponents(
      new LabelBuilder().setLabel('Salon football').setDescription('Résultats et matchs à venir (vide = désactivé)').setChannelSelectMenuComponent(channel('football', cfg.footballChannelId)),
      new LabelBuilder().setLabel('Compétitions de football').setDescription('Celles dont les matchs sont postés').setStringSelectMenuComponent(leagues),
      new LabelBuilder().setLabel('Salon UFC').setDescription('Résultats et prochain événement (vide = désactivé)').setChannelSelectMenuComponent(channel('ufc', cfg.ufcChannelId)),
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
  const leagues = picked.length ? picked : DEFAULT_LEAGUES;
  const before = getSportConfig(guild.id);
  patchSport(guild.id, {
    footballChannelId: football?.id ?? null,
    ufcChannelId: ufc?.id ?? null,
    leagues,
    // Nouveau salon : le tableau repart de zéro dans ce salon.
    ...(football?.id !== before.footballChannelId ? { footballBoard: null } : {}),
    ...(ufc?.id !== before.ufcChannelId ? { ufcBoard: null } : {}),
  });
  const lines = [
    football ? `⚽ **Football** dans ${football} : ${leagues.map((l) => LEAGUES[l]).join(', ')}` : '⚽ Football : désactivé',
    ufc ? `🥊 **UFC** dans ${ufc}` : '🥊 UFC : désactivé',
  ];
  await interaction.reply({
    content: `${lines.join('\n')}${football || ufc ? '\n-# Les derniers résultats et les matchs à venir arrivent dans un instant, puis toutes les 30 min.' : ''}`,
    ephemeral: true,
  });
  await refreshSport(guild).catch((err) => console.error('[sport]', err.message));
}
