import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getGuessFlag, patchGuessFlag } from './store.js';

// Devine le drapeau (/guessflag) : un embed avec un drapeau dans le salon du jeu. Chaque
// message du salon est une réponse, supprimée aussitôt ; la bonne réponse donne un point et
// fait passer au drapeau suivant (même message, modifié). Images : flagcdn.com.

// Pays reconnus par l'ONU + Vatican, Palestine, Kosovo et Taïwan (codes ISO).
const CODES = (
  'AF AL DZ AD AO AG AR AM AU AT AZ BS BH BD BB BY BE BZ BJ BT BO BA BW BR BN BG BF BI CV KH CM CA CF TD CL CN CO KM ' +
  'CG CD CR CI HR CU CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FJ FI FR GA GM GE DE GH GR GD GT GN GW GY HT HN HU IS ' +
  'IN ID IR IQ IE IL IT JM JP JO KZ KE KI KW KG LA LV LB LS LR LY LI LT LU MG MW MY MV ML MT MH MR MU MX FM MD MC MN ' +
  'ME MA MZ MM NA NR NP NL NZ NI NE NG KP MK NO OM PK PW PA PG PY PE PH PL PT QA RO RU RW KN LC VC WS SM ST SA SN RS ' +
  'SC SL SG SK SI SB SO ZA KR SS ES LK SD SR SE CH SY TJ TZ TH TL TG TO TT TN TR TM TV UG UA AE GB US UY UZ VU VA VE ' +
  'VN YE ZM ZW PS XK TW'
).split(' ');

// Nom affiché quand celui de Node n'est pas le plus courant, et autres réponses acceptées.
const NAMES = {
  CD: 'République démocratique du Congo',
  CG: 'République du Congo',
  MM: 'Birmanie',
  PS: 'Palestine',
  VA: 'Vatican',
  FM: 'Micronésie',
};
const ALIASES = {
  US: ['usa', 'us', 'etats unis d amerique', 'amerique'],
  CI: ['ivory coast'],
  TR: ['turkey'],
  GB: ['uk', 'angleterre', 'grande bretagne'],
  AE: ['eau', 'emirats'],
  CD: ['rdc', 'rd congo', 'congo kinshasa'],
  CG: ['congo', 'congo brazzaville'],
  CZ: ['republique tcheque', 'czech republic'],
  MK: ['macedoine', 'macedonia'],
  MM: ['myanmar'],
  NL: ['hollande'],
  SZ: ['swaziland'],
  TL: ['timor leste'],
  CV: ['cabo verde'],
  BA: ['bosnie'],
  CF: ['centrafrique'],
  VA: ['cite du vatican', 'saint siege'],
  PS: ['territoires palestiniens'],
  VN: ['vietnam'],
  KN: ['saint kitts et nevis'],
  VC: ['saint vincent'],
  TT: ['trinidad et tobago'],
  BY: ['bielorussie', 'belarus'],
  KG: ['kirghizistan'],
  FM: ['etats federes de micronesie'],
  MH: ['marshall'],
  SB: ['salomon'],
};

// Minuscules sans accents ni ponctuation, espaces simples, sans article au début.
export function normalize(text) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’'`´\-_.,!?;:()]/g, ' ')
    .replace(/&/g, ' et ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(le|la|les|l) /, '');
}

const frNames = new Intl.DisplayNames(['fr'], { type: 'region' });
const enNames = new Intl.DisplayNames(['en'], { type: 'region' });
const COUNTRIES = Object.fromEntries(
  CODES.map((code) => {
    const name = NAMES[code] ?? frNames.of(code);
    // « Myanmar (Birmanie) » : les deux noms ; « Antigua & Barbuda » : aussi avec « and ».
    const raw = [name, frNames.of(code), enNames.of(code), enNames.of(code).replace(/&/g, 'and'), ...(ALIASES[code] ?? [])];
    const parts = raw.flatMap((n) => n.match(/^(.*?)\s*\((.*)\)$/)?.slice(1) ?? []);
    const answers = new Set([...raw, ...parts].map(normalize));
    return [code, { name, answers }];
  }),
);
// Réponse exacte → pays (pour ne pas confondre Niger / Nigeria, Gambie / Zambie avec les fautes de frappe).
const EXACT = new Map(Object.entries(COUNTRIES).flatMap(([code, c]) => [...c.answers].map((a) => [a, code])));

export const flagEmoji = (code) => String.fromCodePoint(...[...code].map((ch) => 0x1f1e6 + ch.charCodeAt(0) - 65));
export const countryName = (code) => COUNTRIES[code]?.name ?? code;
const flagUrl = (code) => `https://flagcdn.com/w640/${code.toLowerCase()}.png`;

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

// Bonne réponse pour ce pays ? Une petite faute de frappe passe (1 lettre dès 5 lettres,
// 2 dès 10), sauf si le texte est exactement le nom d'un autre pays.
export function isCorrect(guess, code) {
  const g = normalize(guess);
  if (!g) return false;
  const exact = EXACT.get(g);
  if (exact) return exact === code;
  return [...COUNTRIES[code].answers].some((a) => {
    const allowed = a.length >= 10 ? 2 : a.length >= 5 ? 1 : 0;
    return allowed > 0 && Math.abs(a.length - g.length) <= allowed && distance(g, a) <= allowed;
  });
}

// --- Partie ---

function pickCode(recent) {
  const pool = CODES.filter((c) => !recent.includes(c));
  return pool[Math.floor(Math.random() * pool.length)];
}

function gamePayload(state) {
  const { current, last } = state;
  let intro = '';
  if (last) {
    const flag = `${flagEmoji(last.code)} **${countryName(last.code)}**`;
    intro =
      last.by === 'guess'
        ? `🏁 Le dernier drapeau était ${flag}, deviné par <@${last.userId}> !\n\n`
        : `⏩ Le dernier drapeau était ${flag} (passé par <@${last.userId}>).\n\n`;
  }
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('Devinez le drapeau — à quel pays appartient-il ?')
    .setDescription(`${intro}Écris le nom du pays dans ce salon.`)
    .setImage(flagUrl(current.code))
    .setFooter({ text: 'Kayoshi • Devine le drapeau' });
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('gf_hint').setLabel('Demander la première lettre').setStyle(ButtonStyle.Primary).setEmoji('👀'),
        new ButtonBuilder().setCustomId('gf_skip').setLabel('Sauter le drapeau').setStyle(ButtonStyle.Danger).setEmoji('⏩'),
        new ButtonBuilder().setCustomId('gf_top').setLabel('Classement').setStyle(ButtonStyle.Primary).setEmoji('🏅'),
      ),
    ],
    allowedMentions: { parse: [] },
  };
}

// Affiche la partie : modifie le message du jeu, ou en envoie un nouveau s'il a disparu.
async function showGame(channel, state) {
  const payload = gamePayload(state);
  const existing = state.messageId && (await channel.messages.fetch(state.messageId).catch(() => null));
  if (existing && (await existing.edit(payload).then(() => true).catch(() => false))) return;
  const sent = await channel.send(payload).catch(() => null);
  if (sent) patchGuessFlag(channel.guild.id, { messageId: sent.id });
}

// Passe au drapeau suivant ; finished = { by: 'guess' | 'skip', userId } pour le drapeau terminé.
async function nextFlag(channel, finished = null) {
  const state = getGuessFlag(channel.guild.id) ?? {};
  const recent = [...(state.recent ?? []), ...(state.current ? [state.current.code] : [])].slice(-40);
  const patch = { current: { code: pickCode(recent), since: Date.now() }, recent };
  if (finished && state.current) patch.last = { code: state.current.code, ...finished, at: Date.now() };
  if (finished?.by === 'guess') {
    patch.scores = { ...state.scores, [finished.userId]: (state.scores?.[finished.userId] ?? 0) + 1 };
  }
  await showGame(channel, patchGuessFlag(channel.guild.id, patch));
}

// Une réponse ou un passage à la fois par serveur (deux bonnes réponses simultanées = un seul point).
const locks = new Map();
function withLock(guildId, fn) {
  const run = (locks.get(guildId) ?? Promise.resolve()).then(fn, fn);
  locks.set(guildId, run.catch(() => {}));
  return run;
}

// Lance (ou relance) la partie dans ce salon. Le classement est gardé.
export async function startGuessFlag(channel) {
  patchGuessFlag(channel.guild.id, { channelId: channel.id, messageId: null });
  await withLock(channel.guild.id, () => nextFlag(channel));
}

export async function stopGuessFlag(guild) {
  const state = getGuessFlag(guild.id);
  if (!state?.channelId) return false;
  const channel = guild.channels.cache.get(state.channelId);
  const message = state.messageId && (await channel?.messages.fetch(state.messageId).catch(() => null));
  if (message) {
    const embed = EmbedBuilder.from(message.embeds[0]).setDescription('🛑 Partie terminée.');
    await message.edit({ embeds: [embed], components: [] }).catch(() => {});
  }
  patchGuessFlag(guild.id, { channelId: null, messageId: null, current: null });
  return true;
}

export const isGuessFlagChannel = (guildId, channelId) => Boolean(channelId) && getGuessFlag(guildId)?.channelId === channelId;

// Message dans le salon du jeu : toujours supprimé ; bonne réponse → point et drapeau suivant.
// Renvoie true si le message était dans le salon du jeu.
export async function handleGuessFlagMessage(message) {
  if (!message.guild || message.author.bot || !isGuessFlagChannel(message.guild.id, message.channelId)) return false;
  await message.delete().catch(() => {});
  await withLock(message.guild.id, async () => {
    const state = getGuessFlag(message.guild.id);
    if (state?.current && isCorrect(message.content, state.current.code)) {
      await nextFlag(message.channel, { by: 'guess', userId: message.author.id });
    }
  });
  return true;
}

// --- Boutons (préfixe « gf_ ») ---

function hint(name) {
  const letters = [...name].filter((ch) => /\p{L}/u.test(ch)).length;
  const pattern = [...name].map((ch, i) => (i === 0 ? ch.toUpperCase() : /\p{L}/u.test(ch) ? '_' : ch === ' ' ? ' ' : ch)).join(' ');
  return `💡 Première lettre : **${[...name][0].toUpperCase()}**\n\`${pattern}\` (${letters} lettres)`;
}

export async function handleGuessFlagInteraction(interaction) {
  const { guild } = interaction;
  const state = getGuessFlag(guild.id);
  const reply = (content, extra = {}) => interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] }, ...extra });
  if (!state?.channelId) return reply('❌ Aucune partie en cours.');

  if (interaction.customId === 'gf_hint') {
    if (!state.current) return reply('❌ Aucun drapeau en cours.');
    return reply(hint(countryName(state.current.code)));
  }

  if (interaction.customId === 'gf_skip') {
    await interaction.deferUpdate();
    const channel = guild.channels.cache.get(state.channelId) ?? interaction.channel;
    return withLock(guild.id, () => nextFlag(channel, { by: 'skip', userId: interaction.user.id }));
  }

  if (interaction.customId === 'gf_top') {
    const ranking = Object.entries(state.scores ?? {}).sort((a, b) => b[1] - a[1]);
    if (!ranking.length) return reply('🏅 Personne n’a encore deviné de drapeau.');
    const medals = ['🥇', '🥈', '🥉'];
    const lines = ranking
      .slice(0, 10)
      .map(([userId, n], i) => `${medals[i] ?? `**${i + 1}.**`} <@${userId}> — **${n}** drapeau${n > 1 ? 'x' : ''}`);
    const mine = ranking.findIndex(([userId]) => userId === interaction.user.id);
    if (mine >= 10) lines.push(`\nToi : **${mine + 1}ᵉ** avec **${ranking[mine][1]}** drapeaux`);
    const embed = new EmbedBuilder().setColor(0xf0b232).setTitle('🏅 Classement — Devine le drapeau').setDescription(lines.join('\n'));
    return reply('', { embeds: [embed] });
  }
}
