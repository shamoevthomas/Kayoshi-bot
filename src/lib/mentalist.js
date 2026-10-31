import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getMentalist, setMentalist } from './store.js';
import { QUESTIONS, CHARACTERS } from './mentalistdata.js';

// 🔮 Le Mentaliste (« +mentaliste ») : le joueur pense à un personnage d'animé ou de jeu vidéo, ou à une vraie
// personne connue (youtubeur, streamer, rappeur, footballeur…), le bot pose des
// questions (oui / non / je ne sais pas / probablement / probablement pas) puis propose un nom (3 essais).
// Chaque réponse rend les personnages qui collent plus probables ; la question suivante est celle qui partage le
// mieux les personnages restants. S'il perd, le joueur lui dit à qui il pensait : le bot l'apprend pour ce serveur.
// « +mentaliste oublier <nom> » (staff) retire un personnage appris.
const ANSWERS = {
  y: { label: 'Oui', value: 1, style: ButtonStyle.Success },
  n: { label: 'Non', value: 0, style: ButtonStyle.Danger },
  u: { label: 'Je ne sais pas', value: null, style: ButtonStyle.Secondary },
  py: { label: 'Probablement', value: 0.75, style: ButtonStyle.Primary },
  pn: { label: 'Probablement pas', value: 0.25, style: ButtonStyle.Primary },
};
const MIN_QUESTIONS = 6;
const MAX_QUESTIONS = 30;
const MAX_GUESSES = 3;
const CONFIDENT = 0.8;
const AFTER_MISS = 3; // questions avant de reproposer un nom après une erreur
const IDLE_MS = 5 * 60_000;
const COLOR = 0x8e44ad;
const games = new Map(); // id → partie
const quiet = { allowedMentions: { parse: [], repliedUser: false } };

const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const clean = (s) => s.replace(/[*_`~|>#@<]/g, '').replace(/\s+/g, ' ').trim();
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// Personnages de la base, plus ceux appris sur ce serveur. Une correction apprise sur un personnage connu est
// mélangée à ses traits (2/3 la base, 1/3 ce que les joueurs ont répondu).
export function candidates(guildId) {
  const learned = getMentalist(guildId).learned;
  const list = CHARACTERS.map((c) => {
    const extra = learned[norm(c.name)];
    if (!extra) return c;
    const attrs = { ...c.attrs };
    for (const [q, v] of Object.entries(extra.attrs)) attrs[q] = ((attrs[q] ?? 0) * 2 + v) / 3;
    return { ...c, attrs };
  });
  for (const [key, c] of Object.entries(learned)) if (!CHARACTERS.some((b) => norm(b.name) === key)) list.push({ ...c, learned: true });
  return list;
}

// Trait d'un personnage : connu (0 à 1) ; pour un personnage appris, une question jamais posée vaut « ça dépend ».
const valueOf = (c, q) => c.attrs[q] ?? (c.learned ? 0.5 : 0);
const likelihood = (answer, value) => Math.max(0.08, 1 - Math.abs(answer - value) * 0.92);

// Probabilité de chaque personnage d'après les réponses (ceux déjà proposés à tort sont exclus).
export function weigh(list, answers, rejected = new Set()) {
  const w = list.map((c) => {
    if (rejected.has(norm(c.name))) return 0;
    let p = 1;
    for (const { q, a } of answers) if (a !== null) p *= likelihood(a, valueOf(c, q));
    return p;
  });
  const total = w.reduce((s, x) => s + x, 0) || 1;
  return w.map((x) => x / total);
}

// La question qui partage le mieux les personnages encore probables (les « ça dépend » ne comptent pas).
export function bestQuestion(list, weights, asked) {
  let best = null;
  let bestScore = 1e-4;
  for (const q of Object.keys(QUESTIONS)) {
    if (asked.has(q)) continue;
    let yes = 0;
    let no = 0;
    list.forEach((c, i) => {
      const v = valueOf(c, q);
      yes += weights[i] * Math.max(0, 2 * v - 1);
      no += weights[i] * Math.max(0, 1 - 2 * v);
    });
    if (yes * no > bestScore) {
      bestScore = yes * no;
      best = q;
    }
  }
  return best;
}

// Étape suivante : une question, ou un nom à proposer, ou l'abandon.
export function advance(game) {
  const list = candidates(game.guildId);
  const weights = weigh(list, game.answers, game.rejected);
  let top = 0;
  weights.forEach((w, i) => w > weights[top] && (top = i));
  const asked = new Set(game.answers.map((x) => x.q));
  // Toujours la même première question : personnage inventé ou vraie personne.
  const question = game.answers.length === 0 ? 'reel' : bestQuestion(list, weights, asked);
  game.confidence = weights[top];
  const ready = game.answers.length >= MIN_QUESTIONS && weights[top] >= CONFIDENT && game.sinceMiss >= AFTER_MISS;
  if (weights[top] > 0 && (ready || !question || game.answers.length >= MAX_QUESTIONS)) {
    game.phase = 'guess';
    game.guess = list[top];
  } else if (question && game.answers.length < MAX_QUESTIONS) {
    game.phase = 'question';
    game.question = question;
  } else game.phase = 'lost';
}

function stats(guildId) {
  const m = getMentalist(guildId);
  return `Je connais ${candidates(guildId).length} personnages · j’ai deviné juste ${m.won} fois sur ${m.played}`;
}

function bar(p) {
  const n = Math.round(p * 10);
  return '▰'.repeat(n) + '▱'.repeat(10 - n);
}

const button = (game, action, label, style, disabled = false) =>
  new ButtonBuilder().setCustomId(`mnt:${game.id}:${action}`).setLabel(label).setStyle(style).setDisabled(disabled);

function view(game) {
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: game.playerName, iconURL: game.playerAvatar ?? undefined })
    .setThumbnail(game.botAvatar ?? null)
    .setFooter({ text: stats(game.guildId) });
  let components = [];
  if (game.phase === 'question') {
    embed
      .setTitle('🔮 Le Mentaliste')
      .setDescription(
        `**Question ${game.answers.length + 1}**\n## ${QUESTIONS[game.question]}\n\n` +
          `-# ${game.answers.length ? `Intuition : ${bar(game.confidence)}` : 'Pense à un personnage d’animé ou de jeu vidéo, ou à une vraie personne (youtubeur, streamer, rappeur, footballeur…) : je vais le deviner !'}`,
      );
    components = [
      new ActionRowBuilder().addComponents(['y', 'n', 'u'].map((a) => button(game, a, ANSWERS[a].label, ANSWERS[a].style))),
      new ActionRowBuilder().addComponents(['py', 'pn'].map((a) => button(game, a, ANSWERS[a].label, ANSWERS[a].style))),
      new ActionRowBuilder().addComponents(
        button(game, 'undo', '↩️ Corriger', ButtonStyle.Secondary, !game.answers.length),
        button(game, 'stop', 'Abandonner', ButtonStyle.Secondary),
      ),
    ];
  } else if (game.phase === 'guess') {
    embed
      .setTitle('🔮 Je crois que j’ai trouvé…')
      .setDescription(`Tu penses à…\n## ${game.guess.name}\n*${game.guess.work}*\n\nJ’ai bon ?\n-# Essai ${game.guesses + 1}/${MAX_GUESSES} · ${game.answers.length} question(s)`);
    if (game.guess.img) embed.setImage(game.guess.img);
    components = [
      new ActionRowBuilder().addComponents(
        button(game, 'gy', 'Oui, c’est ça !', ButtonStyle.Success),
        button(game, 'gn', 'Non', ButtonStyle.Danger),
      ),
    ];
  } else if (game.phase === 'won') {
    if (game.guess.img) embed.setImage(game.guess.img);
    embed
      .setColor(0x2ecc71)
      .setTitle('🎉 J’ai encore deviné juste !')
      .setDescription(`## ${game.guess.name}\n*${game.guess.work}*\n\nTrouvé en **${game.answers.length}** question(s)${game.guesses ? ` et ${game.guesses + 1} essais` : ''}.\n-# Rejoue avec \`+mentaliste\`.`);
  } else if (game.phase === 'lost') {
    embed
      .setColor(0xe67e22)
      .setTitle('😵 Tu m’as battu !')
      .setDescription(
        `Je ne trouve pas… À qui pensais-tu ?\nDis-le-moi et je m’en souviendrai pour la prochaine fois.\n-# ${game.answers.length} question(s), ${game.guesses} essai(s).`,
      );
    components = [
      new ActionRowBuilder().addComponents(
        button(game, 'teach', '✍️ Te le dire', ButtonStyle.Primary),
        button(game, 'close', 'Non merci', ButtonStyle.Secondary),
      ),
    ];
  } else if (game.phase === 'learned') {
    if (game.taught.img) embed.setImage(game.taught.img);
    embed.setColor(0x3498db).setTitle('🧠 Merci, je m’en souviendrai !').setDescription(`Je retiens **${game.taught.name}** (*${game.taught.work}*).\nLa prochaine fois, je pourrais bien le trouver…\n-# Rejoue avec \`+mentaliste\`.`);
  } else {
    embed.setColor(0x95a5a6).setTitle('🔮 Le Mentaliste').setDescription(game.endText ?? 'Partie terminée.');
  }
  return { embeds: [embed], components, ...quiet };
}

function end(game, phase, text = null) {
  clearTimeout(game.timer);
  games.delete(game.id);
  game.phase = phase;
  if (text) game.endText = text;
}

function record(guildId, won) {
  const m = getMentalist(guildId);
  setMentalist(guildId, { ...m, played: m.played + 1, won: m.won + (won ? 1 : 0) });
}

function arm(game) {
  clearTimeout(game.timer);
  game.timer = setTimeout(async () => {
    if (!games.has(game.id)) return;
    end(game, 'over', '⌛ Partie abandonnée : plus de réponse depuis 5 minutes.');
    await game.message?.edit(view(game)).catch(() => {});
  }, IDLE_MS);
}

export async function handleMentalistCommand(message) {
  if (!message.guild || message.author.bot) return false;
  const match = message.content.trim().match(/^\+(?:mentaliste|mental)(?:\s+(.*))?$/i);
  if (!match) return false;
  const reply = (payload) => message.reply({ ...quiet, ...payload }).catch(() => null);

  // Staff : oublier un personnage appris.
  const forget = match[1]?.match(/^oublier\s+(.+)$/i);
  if (forget) {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
    const m = getMentalist(message.guild.id);
    const key = norm(forget[1]);
    if (!m.learned[key]) return reply({ content: `❌ Je n’ai rien appris sur « ${clean(forget[1])} ».` }).then(() => true);
    const { [key]: removed, ...learned } = m.learned;
    setMentalist(message.guild.id, { ...m, learned });
    await reply({ content: `🗑️ J’ai oublié **${removed.name}**.` });
    return true;
  }

  const running = [...games.values()].find((g) => g.userId === message.author.id && g.guildId === message.guild.id);
  if (running) {
    await reply({ content: `🔮 Tu as déjà une partie en cours : ${running.message?.url ?? 'termine-la d’abord'}` });
    return true;
  }
  const game = {
    id: newId(),
    guildId: message.guild.id,
    userId: message.author.id,
    playerName: message.member?.displayName ?? message.author.username,
    playerAvatar: message.author.displayAvatarURL(),
    botAvatar: message.client.user.displayAvatarURL(),
    answers: [],
    rejected: new Set(),
    guesses: 0,
    sinceMiss: AFTER_MISS,
  };
  advance(game);
  games.set(game.id, game);
  game.message = await reply(view(game));
  if (!game.message) games.delete(game.id);
  else arm(game);
  return true;
}

// Boutons mnt:<partie>:<action> et formulaire mnt_teach:<partie>.
export async function handleMentalistInteraction(interaction) {
  const [kind, id, action] = interaction.customId.split(':');
  const game = games.get(id) ?? taughtGames.get(id);
  if (!game) return interaction.reply({ content: '⌛ Cette partie est terminée. Lance-en une avec `+mentaliste`.', ephemeral: true });
  if (interaction.user.id !== game.userId) {
    return interaction.reply({ content: '🔮 Ce n’est pas ta partie : lance la tienne avec `+mentaliste`.', ephemeral: true });
  }

  if (kind === 'mnt_teach' || (game.phase === 'lost' && action === 'teach')) return teach(interaction, game);
  game.message = interaction.message;

  if (game.phase === 'question' && ANSWERS[action]) {
    game.answers.push({ q: game.question, a: ANSWERS[action].value });
    game.sinceMiss++;
    advance(game);
  } else if (game.phase === 'question' && action === 'undo' && game.answers.length) {
    game.answers.pop();
    advance(game);
  } else if (game.phase === 'question' && action === 'stop') {
    end(game, 'over', `🏳️ ${game.playerName} a abandonné après ${game.answers.length} question(s).`);
  } else if (game.phase === 'guess' && action === 'gy') {
    end(game, 'won');
    record(game.guildId, true);
  } else if (game.phase === 'guess' && action === 'gn') {
    game.rejected.add(norm(game.guess.name));
    game.guesses++;
    game.sinceMiss = 0;
    if (game.guesses >= MAX_GUESSES) game.phase = 'lost';
    else advance(game);
  } else if (game.phase === 'lost' && action === 'close') {
    taughtGames.delete(game.id);
    end(game, 'over', 'Bien joué, tu m’as eu cette fois ! 😤\n-# Rejoue avec `+mentaliste`.');
  } else return interaction.deferUpdate();

  // Le bot a perdu (3 essais ratés, ou plus de question utile) : il attend le nom du personnage 10 min.
  if (game.phase === 'lost' && games.has(game.id)) {
    games.delete(game.id);
    taughtGames.set(game.id, game);
    setTimeout(() => taughtGames.delete(game.id), 10 * 60_000);
    record(game.guildId, false);
  }
  if (games.has(game.id)) arm(game);
  else clearTimeout(game.timer);
  return interaction.update(view(game));
}

// Parties perdues par le bot, en attente du nom du personnage (10 min).
const taughtGames = new Map();

// Image d'un personnage appris : MyAnimeList (le plus suivi de ce nom), sinon la page Wikipédia trouvée pour « nom œuvre ».
const UA = { 'User-Agent': 'KayoshiBot/1.0 (bot Discord)' };
async function getJson(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) }).catch(() => null);
  return res?.ok ? res.json().catch(() => null) : null;
}
export async function findImage(name, work) {
  const mal = await getJson(`https://api.jikan.moe/v4/characters?q=${encodeURIComponent(name)}&limit=3&order_by=favorites&sort=desc`);
  const hit = mal?.data?.find((c) => norm(c.name).includes(norm(name).slice(0, 6)) || norm(name).includes(norm(c.name)));
  if (hit?.images?.jpg?.image_url && !/questionmark/.test(hit.images.jpg.image_url)) return hit.images.jpg.image_url;
  const search = await getJson(
    `https://en.wikipedia.org/w/api.php?action=query&format=json&list=search&srlimit=1&srsearch=${encodeURIComponent(`${name} ${work}`)}`,
  );
  const title = search?.query?.search?.[0]?.title;
  if (!title) return null;
  const pages = await getJson(
    `https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=600&pilicense=any&titles=${encodeURIComponent(title)}`,
  );
  return Object.values(pages?.query?.pages ?? {})[0]?.thumbnail?.source?.split('?')[0] ?? null;
}

async function teach(interaction, game) {
  if (interaction.isButton?.()) {
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId(`mnt_teach:${game.id}`)
        .setTitle('À qui pensais-tu ?')
        .addLabelComponents(
          new LabelBuilder()
            .setLabel('Nom du personnage')
            .setTextInputComponent(new TextInputBuilder().setCustomId('name').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(50)),
          new LabelBuilder()
            .setLabel('D’où il vient (animé, jeu, YouTube, foot…)')
            .setTextInputComponent(new TextInputBuilder().setCustomId('work').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(1).setMaxLength(50)),
        ),
    );
  }
  const name = clean(interaction.fields.getTextInputValue('name')).slice(0, 50);
  const work = clean(interaction.fields.getTextInputValue('work')).slice(0, 50);
  if (!name || !work) return interaction.reply({ content: '❌ Donne un nom et l’œuvre.', ephemeral: true });
  const key = norm(name);
  const m = getMentalist(game.guildId);
  // Réponses données pendant la partie ; un personnage déjà appris garde la moyenne avec ses réponses d'avant.
  const attrs = { ...(m.learned[key]?.attrs ?? {}) };
  for (const { q, a } of game.answers) if (a !== null) attrs[q] = attrs[q] === undefined ? a : (attrs[q] + a) / 2;
  // Image : celle de la base pour un personnage connu, celle déjà trouvée, sinon cherchée (MyAnimeList, Wikipédia).
  await interaction.deferUpdate();
  const known = CHARACTERS.find((c) => norm(c.name) === key);
  const img = known?.img ?? m.learned[key]?.img ?? (await findImage(name, work));
  const fresh = getMentalist(game.guildId);
  setMentalist(game.guildId, { ...fresh, learned: { ...fresh.learned, [key]: { name, work, attrs, img, by: game.userId, at: Date.now() } } });
  taughtGames.delete(game.id);
  game.taught = { name, work, img };
  game.phase = 'learned';
  return interaction.editReply(view(game));
}

