import { EmbedBuilder } from 'discord.js';
import { addCoins, getCounting, getChatGameWins, addChatGameWin } from './store.js';
import { formatMoney } from './shop.js';
import { EMOJI_PUZZLES } from './emojiquiz.js';

// Jeux dans le chat, lancés par n'importe qui : « +pendu », « +devine » (nombre mystère) et « +emoji » (deviner un
// jeu vidéo ou un animé). Une partie à la fois par salon (jamais dans celui du compteur) ; on joue en écrivant
// dans le salon. Le gagnant reçoit des coins, 5 victoires récompensées par jour et par membre au plus.
// Les essais (lettres, nombres, bonne réponse) ne rapportent ni XP ni argent de message.
const REWARDS = { pendu: 250, devine: 150, emoji: 200 };
const DAILY_WINS = 5;
const IDLE_MS = 5 * 60_000; // pendu et devine : fin après 5 min sans essai
const EMOJI_MS = 2 * 60_000;
const EMOJI_HINT_MS = 60_000;
const games = new Map(); // channelId → partie en cours
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const quiet = { allowedMentions: { parse: [], repliedUser: false } };

// --- Mots du pendu (sans espace ni tiret) ---
const WORDS = [
  'ORDINATEUR', 'CLAVIER', 'MONTAGNE', 'PAPILLON', 'CHOCOLAT', 'BOULANGERIE', 'GIRAFE', 'ELEPHANT', 'CROCODILE', 'TELEPHONE',
  'VOITURE', 'BICYCLETTE', 'AVION', 'BATEAU', 'CHATEAU', 'DRAGON', 'SORCIER', 'PIRATE', 'TRESOR', 'VAMPIRE', 'FANTOME',
  'SQUELETTE', 'CITROUILLE', 'PARAPLUIE', 'SOLEIL', 'ETOILE', 'PLANETE', 'GALAXIE', 'ASTRONAUTE', 'FUSEE', 'VOLCAN', 'TORNADE',
  'OURAGAN', 'NUAGE', 'GLACIER', 'DESERT', 'JUNGLE', 'RIVIERE', 'OCEAN', 'REQUIN', 'BALEINE', 'DAUPHIN', 'PIEUVRE', 'TORTUE',
  'PINGOUIN', 'KANGOUROU', 'HIBOU', 'PERROQUET', 'ECUREUIL', 'HERISSON', 'RENARD', 'LAPIN', 'CHAMEAU', 'ZEBRE', 'GUITARE',
  'PIANO', 'TROMPETTE', 'BATTERIE', 'MICROPHONE', 'CONCERT', 'THEATRE', 'MUSEE', 'BIBLIOTHEQUE', 'CAHIER', 'CRAYON', 'CARTABLE',
  'PROFESSEUR', 'VACANCES', 'PLAGE', 'PISCINE', 'SANDWICH', 'PIZZA', 'HAMBURGER', 'SPAGHETTI', 'FROMAGE', 'BAGUETTE',
  'CROISSANT', 'CONFITURE', 'GATEAU', 'BONBON', 'FRAISE', 'CERISE', 'BANANE', 'ANANAS', 'PASTEQUE', 'CAROTTE', 'TOMATE',
  'CHAMPIGNON', 'MANETTE', 'CONSOLE', 'PIXEL', 'ARMURE', 'BOUCLIER', 'POTION', 'DONJON', 'AVENTURE', 'MYSTERE', 'ENIGME',
  'LABYRINTHE', 'CHEVALIER', 'PRINCESSE', 'ROYAUME', 'COURONNE', 'DIAMANT', 'EMERAUDE', 'SAPHIR', 'MAGICIEN', 'BALLON',
  'FOOTBALL', 'BASKETBALL', 'TENNIS', 'MARATHON', 'CHAMPION', 'MEDAILLE', 'TROPHEE', 'ARBITRE', 'HOPITAL', 'DOCTEUR',
  'POMPIER', 'CUISINIER', 'JARDINIER', 'ASCENSEUR', 'ESCALIER', 'FENETRE', 'CHEMINEE', 'CANAPE', 'OREILLER', 'COUVERTURE',
  'PYJAMA', 'DENTIFRICE', 'SAVON', 'SERVIETTE', 'LUNETTES', 'BRACELET', 'COLLIER', 'PARFUM', 'ANNIVERSAIRE', 'CADEAU',
  'SURPRISE', 'DISCORD', 'SERVEUR', 'STREAMER', 'ABONNEMENT', 'NOTIFICATION', 'MESSAGE', 'MODERATEUR', 'CASINO', 'LOTERIE',
];
const MAX_ERRORS = 6;
// Potence à gauche, pendu à droite (il regarde vers la droite).
const GALLOWS = [
  '  +---+\n  |\n  |\n  |\n ===',
  '  +---+\n  |   O\n  |\n  |\n ===',
  '  +---+\n  |   O\n  |   |\n  |\n ===',
  '  +---+\n  |   O\n  |  /|\n  |\n ===',
  '  +---+\n  |   O\n  |  /|\\\n  |\n ===',
  '  +---+\n  |   O\n  |  /|\\\n  |  /\n ===',
  '  +---+\n  |   O\n  |  /|\\\n  |  / \\\n ===',
];
const WRONG_DELETE_MS = 5000; // un essai faux est supprimé au bout de 5 s

// Récompense du gagnant (dans la limite du jour). Renvoie le texte du gain.
function reward(game, userId) {
  const day = dayFormat.format(new Date());
  if (getChatGameWins(game.guildId, userId, day) >= DAILY_WINS) return `-# Limite de ${DAILY_WINS} victoires récompensées par jour atteinte : pas de coins cette fois.`;
  addChatGameWin(game.guildId, userId, day);
  addCoins(game.guildId, userId, REWARDS[game.kind]);
  return `🪙 **+${formatMoney(REWARDS[game.kind])}** coins`;
}

function end(game) {
  clearTimeout(game.timer);
  clearTimeout(game.hintTimer);
  games.delete(game.channelId);
  game.done = true;
}

// Fin automatique (temps écoulé), avec la réponse.
function armIdle(game, ms = IDLE_MS) {
  clearTimeout(game.timer);
  game.timer = setTimeout(async () => {
    if (game.done) return;
    end(game);
    game.timedOut = true;
    await game.message.edit({ embeds: [game.view()] }).catch(() => {});
  }, ms);
}

// --- +pendu ---
function penduView(game) {
  const shown = [...game.word].map((c) => (game.found.has(c) ? c : '_')).join(' ');
  const embed = new EmbedBuilder()
    .setTitle('🪢 Pendu')
    .setDescription(
      `\`\`\`\n${GALLOWS[game.errors]}\n\`\`\`\n# \`${shown}\`\n` +
        `${game.word.length} lettres · ❤️ ${MAX_ERRORS - game.errors} vie(s)${game.wrong.length ? ` · ❌ ${game.wrong.join(' ')}` : ''}\n\n` +
        (game.winner
          ? `🎉 <@${game.winner}> a trouvé **${game.word}** !`
          : game.done
            ? `${game.timedOut ? '⌛ Temps écoulé, le mot était' : '💀 Vous avez perdu, le mot était'} **${game.word}**.`
            : `Écris une **lettre** (ou le mot entier) dans le salon. 🪙 ${REWARDS.pendu} pour celui qui trouve.`),
    );
  return embed.setColor(game.winner ? 0x2ecc71 : game.done ? 0xe74c3c : 0x5865f2);
}

async function penduGuess(game, message, text) {
  const guess = normalize(text).toUpperCase();
  const word = game.word;
  let won = false;
  let reaction;
  // L'état est mis à jour avant tout await : deux essais en même temps ne peuvent pas gagner tous les deux.
  if (/^[A-Z]$/.test(guess)) {
    if (game.found.has(guess) || game.wrong.includes(guess)) reaction = '🔁';
    else if (word.includes(guess)) {
      game.found.add(guess);
      won = [...word].every((c) => game.found.has(c));
      reaction = '✅';
    } else {
      game.wrong.push(guess);
      game.errors++;
      reaction = '❌';
    }
  } else if (/^[A-Z]+$/.test(guess) && guess.length === word.length) {
    if (guess === word) {
      won = true;
      for (const c of word) game.found.add(c);
    } else {
      game.errors++;
      reaction = '❌';
    }
  } else return false; // message normal
  if (reaction === '🔁') {
    await message.react('🔁').catch(() => {});
    return true;
  }
  const lost = !won && game.errors >= MAX_ERRORS;
  if (won) {
    end(game);
    game.winner = message.author.id;
  } else if (lost) end(game);
  else armIdle(game);
  if (reaction) await message.react(reaction).catch(() => {});
  // Essai faux : supprimé au bout de 5 s, pour garder le salon propre.
  if (reaction === '❌') setTimeout(() => message.delete().catch(() => {}), WRONG_DELETE_MS);
  if (won) await message.reply({ content: `🎉 **Bravo ${message.author} !** Le mot était **${word}**. ${reward(game, message.author.id)}`, ...quiet }).catch(() => {});
  if (lost) await message.channel.send({ content: `💀 Vous avez perdu, le mot était **${word}**.`, allowedMentions: { parse: [] } }).catch(() => {});
  await game.message.edit({ embeds: [game.view()] }).catch(() => {});
  return true;
}

// --- +devine : nombre entre 1 et 1000 ---
const DEVINE_MAX = 1000;
function devineView(game) {
  return new EmbedBuilder()
    .setColor(game.winner ? 0x2ecc71 : game.done ? 0xe74c3c : 0xf1c40f)
    .setTitle('🔢 Devine le nombre')
    .setDescription(
      game.winner
        ? `🎉 <@${game.winner}> a trouvé **${game.target}** en ${game.tries} essai(s) au total !`
        : game.done
          ? `⌛ Temps écoulé. Le nombre était **${game.target}**.`
          : `J’ai choisi un nombre entre **1** et **${formatMoney(DEVINE_MAX)}**. Écris un nombre dans le salon : je réponds ⬆️ (plus grand) ou ⬇️ (plus petit).\n\n` +
            `🎯 Il est entre **${game.lo}** et **${game.hi}** · ${game.tries} essai(s)\n🪙 ${REWARDS.devine} pour celui qui trouve.`,
    );
}

async function devineGuess(game, message, text) {
  if (!/^\d{1,4}$/.test(text)) return false;
  const n = Number(text);
  if (n < 1 || n > DEVINE_MAX) return false;
  game.tries++;
  if (n === game.target) {
    end(game);
    game.winner = message.author.id;
    await message.react('🎉').catch(() => {});
    await message.reply({ content: `🎉 **Bravo ${message.author} !** C’était **${game.target}**. ${reward(game, message.author.id)}`, ...quiet }).catch(() => {});
  } else {
    if (n < game.target) game.lo = Math.max(game.lo, n + 1);
    else game.hi = Math.min(game.hi, n - 1);
    await message.react(n < game.target ? '⬆️' : '⬇️').catch(() => {});
    armIdle(game);
  }
  await game.message.edit({ embeds: [game.view()] }).catch(() => {});
  return true;
}

// --- +emoji : deviner un jeu vidéo ou un animé ---
const matches = (puzzle, text) => {
  const full = normalize(text).replace(/[^a-z0-9]/g, '');
  const words = normalize(text).split(/[^a-z0-9]+/).filter(Boolean);
  return [puzzle.answer, ...puzzle.aliases].some((a) => {
    const n = normalize(a).replace(/[^a-z0-9]/g, '');
    return full === n || (n.length >= 4 && full.includes(n)) || words.includes(n);
  });
};

function emojiView(game) {
  const { puzzle } = game;
  const letters = normalize(puzzle.answer).replace(/[^a-z0-9]/g, '');
  return new EmbedBuilder()
    .setColor(game.winner ? 0x2ecc71 : game.done ? 0xe74c3c : 0xeb459e)
    .setTitle(`🧩 Devine ${puzzle.kind === 'jeu' ? 'le jeu vidéo' : 'l’animé'}`)
    .setDescription(
      `# ${puzzle.emojis}\n` +
        (game.winner
          ? `🎉 <@${game.winner}> a trouvé : **${puzzle.answer}** !`
          : game.done
            ? `⌛ Temps écoulé. C’était **${puzzle.answer}**.`
            : `${puzzle.kind === 'jeu' ? '🎮 Un jeu vidéo' : '🍥 Un animé'} : écris son nom dans le salon ! Fin <t:${Math.floor(game.endsAt / 1000)}:R>.\n` +
              (game.hint ? `💡 Indice : ${letters.length} lettres, commence par **${puzzle.answer[0].toUpperCase()}**\n` : '') +
              `🪙 ${REWARDS.emoji} pour celui qui trouve.`),
    );
}

async function emojiGuess(game, message, text) {
  if (!matches(game.puzzle, text)) return false; // les autres messages restent du chat normal
  end(game);
  game.winner = message.author.id;
  await message.react('🎉').catch(() => {});
  await message.reply({ content: `🎉 **Bravo ${message.author} !** C’était **${game.puzzle.answer}**. ${reward(game, message.author.id)}`, ...quiet }).catch(() => {});
  await game.message.edit({ embeds: [game.view()] }).catch(() => {});
  return true;
}

// Pas deux fois de suite la même devinette dans un salon.
const lastPuzzle = new Map();

async function start(message, kind) {
  const { channel, guild } = message;
  if (getCounting(guild.id)?.channelId === channel.id) {
    await message.reply({ content: '❌ Pas de jeu dans le salon du compteur.', ...quiet }).catch(() => {});
    return;
  }
  const running = games.get(channel.id);
  if (running) {
    await message.reply({ content: `❌ Une partie est déjà en cours ici : ${running.message.url}`, ...quiet }).catch(() => {});
    return;
  }
  const game = { kind, guildId: guild.id, channelId: channel.id, done: false, winner: null };
  if (kind === 'pendu') Object.assign(game, { word: pick(WORDS), found: new Set(), wrong: [], errors: 0, view: () => penduView(game) });
  if (kind === 'devine') Object.assign(game, { target: 1 + Math.floor(Math.random() * DEVINE_MAX), lo: 1, hi: DEVINE_MAX, tries: 0, view: () => devineView(game) });
  if (kind === 'emoji') {
    const pool = EMOJI_PUZZLES.filter((p) => p !== lastPuzzle.get(channel.id));
    const puzzle = pick(pool);
    lastPuzzle.set(channel.id, puzzle);
    Object.assign(game, { puzzle, hint: false, endsAt: Date.now() + EMOJI_MS, view: () => emojiView(game) });
  }
  games.set(channel.id, game);
  game.message = await channel.send({ embeds: [game.view()], allowedMentions: { parse: [] } }).catch(() => null);
  if (!game.message) return games.delete(channel.id);
  if (kind === 'emoji') {
    armIdle(game, EMOJI_MS);
    game.hintTimer = setTimeout(() => {
      if (game.done) return;
      game.hint = true;
      game.message.edit({ embeds: [game.view()] }).catch(() => {});
    }, EMOJI_HINT_MS);
  } else armIdle(game);
}

const STARTS = { '+pendu': 'pendu', '+devine': 'devine', '+emoji': 'emoji' };
const GUESS = { pendu: penduGuess, devine: devineGuess, emoji: emojiGuess };

// Renvoie true si le message a servi au jeu (lancement ou essai) : il ne compte alors pas pour l'XP.
export async function handleChatGames(message) {
  if (!message.guild || message.author.bot) return false;
  const text = message.content.trim();
  const kind = STARTS[text.toLowerCase()];
  if (kind) {
    await start(message, kind);
    return true;
  }
  const game = games.get(message.channelId);
  if (!game || game.done || !text) return false;
  return GUESS[game.kind](game, message, text);
}
