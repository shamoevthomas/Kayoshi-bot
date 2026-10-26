import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getQuiz, addMoney, addQuizWin } from './store.js';
import { formatMoney } from './shop.js';

// Quiz de culture générale (/quiz) : de temps en temps, une question à 4 réponses (boutons) dans le
// salon choisi ; le premier qui trouve gagne de l'argent (+1 au classement « Quiz » de /top). Une seule
// réponse par personne et par question. Questions en français de QuizzAPI (quizzapi.jomoreschi.fr),
// avec une petite réserve intégrée si l'API ne répond pas. Pas de question si le serveur est calme.
const EXPIRE_MS = 3 * 60_000;
const ACTIVE_WINDOW_MS = 30 * 60_000; // une question seulement si quelqu'un a écrit dans les 30 dernières min
const LETTERS = ['A', 'B', 'C', 'D'];
const CATEGORIES = {
  art_litterature: '📚 Art & littérature',
  culture_generale: '🧠 Culture générale',
  divertissement: '🎭 Divertissement',
  geographie: '🌍 Géographie',
  histoire: '🏛️ Histoire',
  sport: '⚽ Sport',
  tv_cinema: '🎬 TV & cinéma',
  actu_politique: '📰 Actualité & politique',
  musique: '🎵 Musique',
  jeux_videos: '🎮 Jeux vidéo',
  informatique: '💻 Informatique',
  sciences: '🔬 Sciences',
  gastronomie: '🍽️ Gastronomie',
  nature: '🌿 Nature',
  bd: '💬 BD',
};
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
];

const active = new Map(); // messageId → { correct, answer, tried: Set, done, reward }
const nextQuizAt = new Map(); // guildId → instant de la prochaine question
const lastActivity = new Map(); // guildId → dernier message d'un membre

const shuffle = (list) => list.map((v) => [Math.random(), v]).sort((a, b) => a[0] - b[0]).map(([, v]) => v);

// Message d'un membre : le serveur est actif (voir ACTIVE_WINDOW_MS).
export function noteQuizActivity(message) {
  if (message.guild && !message.author.bot) lastActivity.set(message.guild.id, Date.now());
}

async function fetchQuestion() {
  try {
    const res = await fetch('https://quizzapi.jomoreschi.fr/api/v2/quiz?limit=1', { signal: AbortSignal.timeout(5000) });
    const q = res.ok ? (await res.json()).quizzes?.[0] : null;
    if (q?.question && q.answer && q.badAnswers?.length >= 3) {
      return { question: q.question, answer: q.answer, wrong: q.badAnswers.slice(0, 3), category: q.category, difficulty: q.difficulty };
    }
  } catch {}
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
  const q = await fetchQuestion();
  const choices = shuffle([q.answer, ...q.wrong]);
  const correct = choices.indexOf(q.answer);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🧠 Quiz !')
    .setDescription(`**${q.question}**\n\nLe premier qui trouve gagne 💰 **${formatMoney(cfg.reward)}** — une seule réponse par personne.`)
    .setFooter({ text: [CATEGORIES[q.category], DIFFICULTY[q.difficulty], 'Fin dans 3 min'].filter(Boolean).join(' · ') });
  const message = await channel.send({ embeds: [embed], components: [buttons(choices)] }).catch(() => null);
  if (!message) return null;
  active.set(message.id, { guildId: guild.id, correct, answer: q.answer, choices, tried: new Set(), done: false, reward: cfg.reward });
  setTimeout(() => expire(message), EXPIRE_MS);
  return message;
}

async function expire(message) {
  const state = active.get(message.id);
  if (!state || state.done) return;
  state.done = true;
  const embed = EmbedBuilder.from(message.embeds[0])
    .setColor(0x4e5058)
    .setDescription(`${message.embeds[0].description.split('\n\n')[0]}\n\n⌛ Personne n’a trouvé. La réponse était : **${state.answer}**.`);
  await message.edit({ embeds: [embed], components: [buttons(state.choices, { correct: state.correct, disabled: true })] }).catch(() => {});
}

// Bouton de réponse : le premier qui trouve gagne ; une seule tentative par personne.
export async function handleQuizInteraction(interaction) {
  const state = active.get(interaction.message.id);
  if (!state || state.done) return interaction.reply({ content: '⌛ Ce quiz est terminé.', ephemeral: true });
  if (state.tried.has(interaction.user.id)) return interaction.reply({ content: 'Tu as déjà répondu à cette question.', ephemeral: true });
  state.tried.add(interaction.user.id);
  const index = Number(interaction.customId.split(':')[1]);
  if (index !== state.correct) {
    return interaction.reply({ content: '❌ Raté ! Tu ne peux plus répondre à cette question.', ephemeral: true });
  }
  state.done = true;
  addMoney(state.guildId, interaction.user.id, state.reward);
  addQuizWin(state.guildId, interaction.user.id);
  const original = interaction.message.embeds[0];
  const embed = EmbedBuilder.from(original)
    .setColor(0x57f287)
    .setDescription(`${original.description.split('\n\n')[0]}\n\n✅ ${interaction.user} a trouvé : **${state.answer}** (+💰 ${formatMoney(state.reward)}) !`);
  await interaction.update({ embeds: [embed], components: [buttons(state.choices, { correct: state.correct, disabled: true })] });
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
    if ([...active.values()].some((s) => s.guildId === guild.id && !s.done)) continue;
    nextQuizAt.set(guild.id, now + cfg.everyMin * 60_000);
    await postQuiz(guild).catch((err) => console.error('[quiz]', err));
  }
}
