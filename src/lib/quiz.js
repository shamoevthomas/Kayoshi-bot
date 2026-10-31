import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits, SnowflakeUtil } from 'discord.js';
import { getQuiz, addMoney, addCoins, addQuizWin, getQuizActive, setQuizActive } from './store.js';
import { formatMoney } from './shop.js';
import { ANIME_QUESTIONS } from './quizanime.js';
import { GAME_QUESTIONS } from './quizgames.js';

// Quiz de culture générale (/quiz) : de temps en temps, une question à 4 réponses (boutons) dans le
// salon choisi ; chaque membre qui trouve gagne de l'argent et des coins (+1 au classement « Quiz » de /top), avec un
// message de félicitations qu'il est seul à voir ; la réponse n'est dévoilée qu'à la fin. Une seule
// réponse par personne et par question, 30 min pour trouver. Un tiers de culture générale (QuizzAPI,
// quizzapi.jomoreschi.fr, avec une réserve si l'API ne répond pas), un tiers de jeux vidéo (QuizzAPI et
// lib/quizgames.js), un tiers d'animés (lib/quizanime.js). Pas de question si le serveur est calme.
const EXPIRE_MS = 30 * 60_000;
const QUIZ_COINS = 500; // coins du casino pour la bonne réponse, en plus de l'argent
const ACTIVE_WINDOW_MS = 30 * 60_000; // une question seulement si quelqu'un a écrit dans les 30 dernières min
const LETTERS = ['A', 'B', 'C', 'D'];
const CATEGORIES = {
  art_litterature: '📚 Art & littérature',
  culture_generale: '🧠 Culture générale',
  divertissement: '🎭 Divertissement',
  geographie: '🌍 Géographie',
  histoire: '🏛️ Histoire',
  sport: '⚽ Sport',
  musique: '🎵 Musique',
  jeux_videos: '🎮 Jeux vidéo',
  informatique: '💻 Informatique',
  sciences: '🔬 Sciences',
  gastronomie: '🍽️ Gastronomie',
  nature: '🌿 Nature',
  bd: '💬 BD',
  anime: '🎌 Animé & manga',
};
// Catégories de QuizzAPI jamais posées : actualité et politique, TV et cinéma.
const EXCLUDED = new Set(['actu_politique', 'tv_cinema']);
const DIFFICULTY = { facile: '🟢 Facile', normal: '🟡 Moyen', difficile: '🔴 Difficile' };

// Réserve si l'API ne répond pas.
const BACKUP = [
  ['Quelle est la capitale de l’Australie ?', 'Canberra', ['Sydney', 'Melbourne', 'Perth'], 'geographie'],
  ['Combien de joueurs compte une équipe de football sur le terrain ?', '11', ['10', '12', '9'], 'sport'],
  ['Quel est le plus grand océan du monde ?', 'Le Pacifique', ['L’Atlantique', 'L’Indien', 'L’Arctique'], 'geographie'],
  ['Qui a peint la Joconde ?', 'Léonard de Vinci', ['Michel-Ange', 'Raphaël', 'Botticelli'], 'art_litterature'],
  ['Quel est le symbole chimique de l’or ?', 'Au', ['Ag', 'Or', 'Fe'], 'sciences'],
  ['En quelle année a eu lieu la prise de la Bastille ?', '1789', ['1792', '1776', '1815'], 'histoire'],
  ['Quelle planète est surnommée la planète rouge ?', 'Mars', ['Jupiter', 'Vénus', 'Mercure'], 'sciences'],
  ['Combien de côtés a un hexagone ?', '6', ['5', '7', '8'], 'culture_generale'],
  ['Quel pays a remporté la Coupe du monde de football 2018 ?', 'La France', ['La Croatie', 'La Belgique', 'Le Brésil'], 'sport'],
  ['Quel est le plus long fleuve de France ?', 'La Loire', ['La Seine', 'Le Rhône', 'La Garonne'], 'geographie'],
  ['Qui a écrit « Les Misérables » ?', 'Victor Hugo', ['Émile Zola', 'Gustave Flaubert', 'Alexandre Dumas'], 'art_litterature'],
  ['Combien y a-t-il de minutes dans une journée ?', '1 440', ['1 200', '1 640', '2 400'], 'culture_generale'],
  ['Quel animal est le plus grand mammifère du monde ?', 'La baleine bleue', ['L’éléphant d’Afrique', 'Le cachalot', 'La girafe'], 'nature'],
  ['Dans quel pays se trouve le Machu Picchu ?', 'Le Pérou', ['Le Mexique', 'La Bolivie', 'Le Chili'], 'geographie'],
  ['Quel gaz les plantes absorbent-elles pour la photosynthèse ?', 'Le dioxyde de carbone', ['L’oxygène', 'L’azote', 'L’hélium'], 'sciences'],
  ['Qui était le premier homme à marcher sur la Lune ?', 'Neil Armstrong', ['Buzz Aldrin', 'Youri Gagarine', 'Michael Collins'], 'histoire'],
  ['Quel est le plat national italien le plus connu, à base de pâte, de sauce tomate et de mozzarella ?', 'La pizza', ['La paella', 'Le couscous', 'La moussaka'], 'gastronomie'],
  ['Quelle est la langue la plus parlée au Brésil ?', 'Le portugais', ['L’espagnol', 'Le brésilien', 'L’anglais'], 'geographie'],
  ['Combien de cordes a une guitare classique ?', '6', ['4', '5', '7'], 'musique'],
  ['Quel personnage de Nintendo est un plombier moustachu ?', 'Mario', ['Link', 'Wario', 'Kirby'], 'jeux_videos'],
  ['Comment s’appelle le héros de la série « The Legend of Zelda » ?', 'Link', ['Zelda', 'Ganon', 'Navi'], 'jeux_videos'],
  ['Dans « Minecraft », quelle créature verte explose quand elle s’approche ?', 'Le creeper', ['Le zombie', 'L’enderman', 'Le slime'], 'jeux_videos'],
  ['Quel hérisson bleu est la mascotte de Sega ?', 'Sonic', ['Shadow', 'Knuckles', 'Tails'], 'jeux_videos'],
  ['Dans « Pac-Man », que mange le personnage ?', 'Des pac-gommes', ['Des pièces', 'Des étoiles', 'Des champignons'], 'jeux_videos'],
];

const nextQuizAt = new Map(); // guildId → instant de la prochaine question
const lastActivity = new Map(); // guildId → dernier message d'un membre

const shuffle = (list) => list.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

// Message d'un membre : le serveur est actif (voir ACTIVE_WINDOW_MS).
export function noteQuizActivity(message) {
  if (message.guild && !message.author.bot) lastActivity.set(message.guild.id, Date.now());
}

// Banques de questions du bot (animés, jeux populaires). Celles posées récemment (par serveur et par
// banque) ne reviennent pas avant que la moitié des autres soit passée.
const LOCAL = { anime: ANIME_QUESTIONS, jeux_videos: GAME_QUESTIONS };
const recent = new Map(); // `${guildId}:${banque}` → [indices]

function localQuestion(guildId, category) {
  const bank = LOCAL[category];
  const key = `${guildId}:${category}`;
  const seen = recent.get(key) ?? [];
  const free = bank.map((_, i) => i).filter((i) => !seen.includes(i));
  const index = free[Math.floor(Math.random() * free.length)];
  recent.set(key, [...seen, index].slice(-Math.floor(bank.length / 2)));
  const [question, answer, wrong] = bank[index];
  return { question, answer, wrong, category, difficulty: null };
}

// Une question sur trois de chaque thème : culture générale (toutes catégories), jeux vidéo, animés.
// Jeux vidéo : une fois sur deux les jeux populaires du bot (Fortnite, Valorant, Minecraft, GTA…), sinon QuizzAPI.
async function fetchQuestion(guildId) {
  const theme = ['general', 'jeux_videos', 'anime'][Math.floor(Math.random() * 3)];
  if (theme === 'anime' || (theme === 'jeux_videos' && Math.random() < 0.5)) return localQuestion(guildId, theme);
  const filter = theme === 'jeux_videos' ? '&category=jeux_videos' : '';
  try {
    // 5 questions d'un coup : on écarte les catégories exclues (EXCLUDED).
    const res = await fetch(`https://quizzapi.jomoreschi.fr/api/v2/quiz?limit=5${filter}`, { signal: AbortSignal.timeout(5000) });
    const list = res.ok ? ((await res.json()).quizzes ?? []) : [];
    const q = list.find((x) => !EXCLUDED.has(x.category) && x.question && x.answer && x.badAnswers?.length >= 3);
    if (q) return { question: q.question, answer: q.answer, wrong: q.badAnswers.slice(0, 3), category: q.category, difficulty: q.difficulty };
  } catch {}
  // L'API ne répond pas : jeux vidéo → la banque du bot, sinon la petite réserve.
  if (theme === 'jeux_videos') return localQuestion(guildId, theme);
  const [question, answer, wrong, category] = BACKUP[Math.floor(Math.random() * BACKUP.length)];
  return { question, answer, wrong, category, difficulty: null };
}

const label = (letter, text) => `${letter} · ${text}`.slice(0, 80);

function buttons(choices, { correct = null, disabled = false } = {}) {
  return new ActionRowBuilder().addComponents(
    choices.map((text, i) =>
      new ButtonBuilder()
        .setCustomId(`quiz_ans:${i}`)
        .setLabel(label(LETTERS[i], text))
        .setStyle(correct === null ? ButtonStyle.Primary : i === correct ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(disabled),
    ),
  );
}

// Pose une question dans le salon du quiz. Renvoie le message, ou null.
export async function postQuiz(guild) {
  const cfg = getQuiz(guild.id);
  const channel = cfg?.channelId && guild.channels.cache.get(cfg.channelId);
  if (!channel?.isTextBased?.()) return null;
  const q = await fetchQuestion(guild.id);
  const choices = shuffle([q.answer, ...q.wrong]);
  const correct = choices.indexOf(q.answer);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🧠 Quiz !')
    .setDescription(
      `**${q.question}**\n\nChaque bonne réponse gagne 💰 **${formatMoney(cfg.reward)}** et 🪙 **${formatMoney(QUIZ_COINS)}** — une seule réponse par personne.\n⏳ Fin <t:${Math.floor((Date.now() + EXPIRE_MS) / 1000)}:R>`,
    )
    .setFooter({ text: [CATEGORIES[q.category], DIFFICULTY[q.difficulty], '30 min pour trouver'].filter(Boolean).join(' · ') });
  // Rôle mentionné à chaque question (/quiz activer role) : @everyone s'il a été choisi.
  let ping = { allowedMentions: { parse: [] } };
  if (cfg.roleId === guild.id) ping = { content: '@everyone', allowedMentions: { parse: ['everyone'] } };
  else if (cfg.roleId) ping = { content: `<@&${cfg.roleId}>`, allowedMentions: { roles: [cfg.roleId] } };
  const message = await channel.send({ ...ping, embeds: [embed], components: [buttons(choices)] }).catch(() => null);
  if (!message) return null;
  track(guild, message, { correct, answer: q.answer, choices, reward: cfg.reward, head: embed.data.description }, EXPIRE_MS);
  return message;
}

// --- « Qui a dit ? » (/quiz qui-a-dit) : un vieux message du serveur, à qui est-il ? ---
// Seulement dans les salons que tout le monde voit (jamais un salon du staff), d'un membre encore là.
const WHO_EXPIRE_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

async function randomOldMessage(guild) {
  if (guild.members.cache.size < guild.memberCount) await guild.members.fetch().catch(() => {});
  const me = guild.members.me;
  const channels = guild.channels.cache.filter(
    (c) =>
      c.type === ChannelType.GuildText &&
      !c.nsfw &&
      c.permissionsFor(guild.roles.everyone)?.has(PermissionFlagsBits.ViewChannel) &&
      c.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory]),
  );
  for (let attempt = 0; attempt < 8 && channels.size; attempt++) {
    const channel = channels.random();
    const to = Date.now() - DAY_MS;
    if (to <= channel.createdTimestamp) continue;
    const at = channel.createdTimestamp + Math.random() * (to - channel.createdTimestamp);
    const batch = await channel.messages.fetch({ before: SnowflakeUtil.generate({ timestamp: Math.floor(at) }).toString(), limit: 100 }).catch(() => null);
    if (!batch) continue;
    const humans = batch.filter((m) => !m.author.bot && guild.members.cache.has(m.author.id));
    // Texte seul, ni trop court ni trop long, sans lien, mention ni commande.
    const ok = humans.filter((m) => m.content.length >= 15 && m.content.length <= 300 && !/https?:\/\/|discord\.gg|<[@#]|^[./+!?]/i.test(m.content));
    if (ok.size) return { message: ok.random(), authors: [...new Set(humans.map((m) => m.author.id))] };
  }
  return null;
}

// Pose « Qui a dit ? » dans `channel`. Renvoie le message, ou une raison d'échec (texte).
export async function postWhoSaid(guild, channel) {
  const found = await randomOldMessage(guild);
  if (!found) return 'Je n’ai pas trouvé de vieux message utilisable (il faut des salons publics avec un peu d’historique).';
  const author = found.message.author.id;
  // Mauvaises réponses : d'autres membres du même salon à la même époque, puis d'autres membres au hasard.
  const others = [...found.authors.filter((id) => id !== author)];
  const pool = [...guild.members.cache.filter((m) => !m.user.bot && m.id !== author && !others.includes(m.id)).keys()];
  while (others.length < 3 && pool.length) others.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  if (others.length < 3) return 'Il faut au moins 4 membres sur le serveur.';
  const ids = shuffle([author, ...shuffle(others).slice(0, 3)]);
  const nameOf = (id) => guild.members.cache.get(id)?.displayName ?? 'Inconnu';
  const choices = ids.map(nameOf);
  const correct = ids.indexOf(author);
  const reward = getQuiz(guild.id)?.reward ?? 100;
  const date = new Date(found.message.createdTimestamp).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long', year: 'numeric' });
  const embed = new EmbedBuilder()
    .setColor(0xeb459e)
    .setTitle('🗨️ Qui a dit ?')
    .setDescription(
      `**« ${found.message.content.replace(/\n+/g, ' ')} »**\n\nChaque bonne réponse gagne 💰 **${formatMoney(reward)}** et 🪙 **${formatMoney(QUIZ_COINS)}** — une seule réponse par personne.\n⏳ Fin <t:${Math.floor((Date.now() + WHO_EXPIRE_MS) / 1000)}:R>`,
    )
    .setFooter({ text: `Message du ${date} · 5 min pour trouver` });
  const message = await channel.send({ embeds: [embed], components: [buttons(choices)], allowedMentions: { parse: [] } }).catch(() => null);
  if (!message) return 'Je ne peux pas écrire dans ce salon.';
  track(guild, message, { correct, answer: choices[correct], choices, reward, head: embed.data.description }, WHO_EXPIRE_MS);
  return message;
}

// Question en cours : enregistrée (elle survit à un redémarrage du bot) et terminée au bout de `ms`.
function track(guild, message, question, ms) {
  setQuizActive(guild.id, message.id, { ...question, channelId: message.channelId, tried: [], winners: [], endsAt: Date.now() + ms });
  schedule(guild.client, guild.id, message.id, ms);
}

const timers = new Map(); // messageId → minuteur de fin
function schedule(client, guildId, messageId, ms) {
  clearTimeout(timers.get(messageId));
  timers.set(
    messageId,
    setTimeout(() => expire(client, guildId, messageId).catch((err) => console.error('[quiz]', err)), Math.max(0, ms)),
  );
}

// Au démarrage : les questions en cours reprennent (celles dont le temps est passé se terminent tout de suite).
export function resumeQuizzes(client) {
  for (const guildId of client.guilds.cache.keys()) {
    for (const [messageId, state] of Object.entries(getQuizActive(guildId))) schedule(client, guildId, messageId, (state.endsAt ?? 0) - Date.now());
  }
}

// Fin du temps : la réponse est dévoilée, avec ceux qui l'ont trouvée.
async function expire(client, guildId, messageId) {
  timers.delete(messageId);
  const state = getQuizActive(guildId)[messageId];
  if (!state) return;
  setQuizActive(guildId, messageId, null); // terminée d'abord : plus de réponse acceptée
  const channel = client.channels.cache.get(state.channelId) ?? (await client.channels.fetch(state.channelId).catch(() => null));
  const message = await channel?.messages?.fetch(messageId).catch(() => null);
  if (!message?.embeds?.[0]) return;
  const { winners } = state;
  const names = winners.slice(0, 20).map((id) => `<@${id}>`).join(', ') + (winners.length > 20 ? ` et ${winners.length - 20} autre(s)` : '');
  const result = winners.length
    ? `✅ La réponse était : **${state.answer}**.\nTrouvée par ${names} (+💰 ${formatMoney(state.reward)} et +🪙 ${formatMoney(QUIZ_COINS)} chacun).`
    : `⌛ Personne n’a trouvé. La réponse était : **${state.answer}**.`;
  const embed = EmbedBuilder.from(message.embeds[0])
    .setColor(winners.length ? 0x57f287 : 0x4e5058)
    .setDescription(`${message.embeds[0].description.split('\n\n')[0]}\n\n${result}`);
  await message.edit({ embeds: [embed], components: [buttons(state.choices, { correct: state.correct, disabled: true })] }).catch(() => {});
}

// Bouton de réponse : chaque bonne réponse gagne (félicitations en message éphémère, la question reste
// ouverte pour les autres) ; une seule tentative par personne.
export async function handleQuizInteraction(interaction) {
  const guildId = interaction.guildId;
  const messageId = interaction.message.id;
  const saved = getQuizActive(guildId)[messageId];
  if (!saved || saved.endsAt <= Date.now()) return interaction.reply({ content: '⌛ Ce quiz est terminé.', ephemeral: true });
  if (saved.tried.includes(interaction.user.id)) return interaction.reply({ content: 'Tu as déjà répondu à cette question.', ephemeral: true });
  // Enregistré avant tout await : deux clics en même temps ne se marchent pas dessus.
  const index = Number(interaction.customId.split(':')[1]);
  const right = index === saved.correct;
  const state = { ...saved, tried: [...saved.tried, interaction.user.id], winners: right ? [...saved.winners, interaction.user.id] : saved.winners };
  setQuizActive(guildId, messageId, state);
  if (!right) {
    return interaction.reply({ content: '❌ Raté ! Tu ne peux plus répondre à cette question.', ephemeral: true });
  }
  addMoney(guildId, interaction.user.id, state.reward);
  addCoins(guildId, interaction.user.id, QUIZ_COINS);
  addQuizWin(guildId, interaction.user.id);
  await interaction.reply({
    content:
      `🎉 **Félicitations, c’est la bonne réponse : ${state.answer} !** Tu remportes 💰 **${formatMoney(state.reward)}** et 🪙 **${formatMoney(QUIZ_COINS)}**.\n` +
      '-# Garde-la pour toi 🤫 : les autres peuvent encore jouer, la réponse sera dévoilée à la fin.',
    ephemeral: true,
  });
  // Sur la question : le nombre de membres qui ont trouvé (sans dévoiler la réponse).
  const n = state.winners.length;
  const embed = EmbedBuilder.from(interaction.message.embeds[0]).setDescription(`${state.head}\n\n✅ **${n}** membre${n > 1 ? 's ont' : ' a'} trouvé pour l’instant.`);
  await interaction.message.edit({ embeds: [embed] }).catch(() => {});
}

// Toutes les minutes : une question quand le délai est passé, si le serveur est actif et qu'aucune
// question n'attend de réponse.
export async function quizTick(client) {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    const cfg = getQuiz(guild.id);
    if (!cfg?.enabled) continue;
    const next = nextQuizAt.get(guild.id);
    if (next === undefined) {
      nextQuizAt.set(guild.id, now + cfg.everyMin * 60_000);
      continue;
    }
    if (now < next || now - (lastActivity.get(guild.id) ?? 0) > ACTIVE_WINDOW_MS) continue;
    if (Object.keys(getQuizActive(guild.id)).length) continue; // une question attend encore
    nextQuizAt.set(guild.id, now + cfg.everyMin * 60_000);
    await postQuiz(guild).catch((err) => console.error('[quiz]', err));
  }
}
