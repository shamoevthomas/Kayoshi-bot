import { EmbedBuilder } from 'discord.js';
import { addCoins, getCounting, getChatGameWins, addChatGameWin, getChatGameStats, addChatGameStat } from './store.js';
import { formatMoney } from './shop.js';
import { EMOJI_PUZZLES } from './emojiquiz.js';
import { POKEMON } from './pokemondata.js';
import { pokemonImages, pokeKey, matchesPokemon } from './pokemonart.js';
import { pickCode, flagUrl, hint as flagHint, isCorrect, countryName, flagEmoji } from './guessflag.js';

// Jeux dans le chat, lancés par n'importe qui : « +pendu », « +devine » (nombre mystère), « +emoji » (deviner un
// jeu vidéo ou un animé), « +pokemon [génération] » (la silhouette d'un Pokémon) et « +flag » (le drapeau d'un pays).
// Une partie à la fois par salon (jamais dans celui du compteur) ; on joue en écrivant
// dans le salon. Le gagnant reçoit des coins, 5 victoires récompensées par jour et par membre au plus.
// Les essais (lettres, nombres, bonne réponse) ne rapportent ni XP ni argent de message.
const REWARDS = { pendu: 250, devine: 150, emoji: 200, pokemon: 200, flag: 150 };
const DAILY_WINS = 5;
const IDLE_MS = 5 * 60_000; // pendu et devine : fin après 5 min sans essai
const EMOJI_MS = 2 * 60_000;
const EMOJI_HINT_MS = 60_000;
const games = new Map(); // channelId → partie en cours
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
const normalize = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const quiet = { allowedMentions: { parse: [], repliedUser: false } };
// Contenu du message du jeu : l'embed, plus l'image pour +pokemon (silhouette, puis le Pokémon dévoilé).
const payloadOf = (game) => (game.payload ? game.payload() : { embeds: [game.view()] });

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

// Récompense du gagnant (dans la limite du jour). Renvoie le texte du gain. La victoire compte toujours pour +jeux top.
function reward(game, userId) {
  addChatGameStat(game.guildId, userId, game.kind);
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
    await game.message.edit(payloadOf(game)).catch(() => {});
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
  await game.message.edit(payloadOf(game)).catch(() => {});
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
  await game.message.edit(payloadOf(game)).catch(() => {});
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
  await game.message.edit(payloadOf(game)).catch(() => {});
  return true;
}

// --- +pokemon [génération] : la silhouette d'un Pokémon, le premier qui trouve son nom gagne ---
const POKEMON_MS = 60_000;
const POKEMON_HINT_MS = 25_000;
const recentPokemon = new Map(); // salon → derniers Pokémon tirés (pas de répétition)

function pokemonView(game) {
  const [id, fr, en, gen, types] = game.pokemon;
  const names = fr === en ? `**${fr}**` : `**${fr}** (${en})`;
  const details = `-# n°${id} · ${types} · génération ${gen}`;
  const embed = new EmbedBuilder()
    .setColor(game.winner ? 0x2ecc71 : game.done ? 0xe74c3c : 0xffcb05)
    .setTitle(game.done ? `${game.winner ? '🎉' : '⌛'} C’était ${fr} !` : '❓ Quel est ce Pokémon ?')
    .setImage('attachment://pokemon.png')
    .setDescription(
      game.winner
        ? `<@${game.winner}> a trouvé : ${names} !\n${details}`
        : game.done
          ? `Personne n’a trouvé. C’était ${names}.\n${details}`
          : `Écris son nom dans le salon (en français ou en anglais) ! Fin <t:${Math.floor(game.endsAt / 1000)}:R>.\n` +
            (game.hint ? `💡 Indice : type **${types}** · génération ${gen} · commence par **${fr[0]}** (${pokeKey(fr).length} lettres)\n` : '') +
            `🪙 ${REWARDS.pokemon} pour celui qui trouve.` +
            (game.genFilter ? `\n-# Génération ${game.genFilter} seulement.` : ''),
    );
  return embed;
}

async function pokemonGuess(game, message, text) {
  const ok = matchesPokemon(text, game.pokemon);
  if (!ok) return false; // les autres messages restent du chat normal
  end(game);
  game.winner = message.author.id;
  await message.react('🎉').catch(() => {});
  await message.reply({ content: `🎉 **Bravo ${message.author} !** C’était **${game.pokemon[1]}**. ${reward(game, message.author.id)}`, ...quiet }).catch(() => {});
  await game.message.edit(payloadOf(game)).catch(() => {});
  return true;
}

// --- +flag : le drapeau d'un pays, le premier qui écrit son nom gagne ---
const FLAG_MS = 60_000;
const FLAG_HINT_MS = 25_000;
const recentFlags = new Map(); // salon → derniers drapeaux tirés (pas de répétition)

function flagView(game) {
  const name = countryName(game.code);
  return new EmbedBuilder()
    .setColor(game.winner ? 0x2ecc71 : game.done ? 0xe74c3c : 0x3498db)
    .setTitle(game.done ? `${game.winner ? '🎉' : '⌛'} C’était ${name} ${flagEmoji(game.code)}` : '🏳️ Quel est ce drapeau ?')
    .setImage(flagUrl(game.code))
    .setDescription(
      game.winner
        ? `<@${game.winner}> a trouvé : **${name}** !`
        : game.done
          ? `Personne n’a trouvé. C’était **${name}**.`
          : `Écris le nom du pays dans le salon ! Fin <t:${Math.floor(game.endsAt / 1000)}:R>.\n` +
            (game.hint ? `💡 Indice : ${flagHint(name)}\n` : '') +
            `🪙 ${REWARDS.flag} pour celui qui trouve.`,
    );
}

async function flagGuess(game, message, text) {
  if (!isCorrect(text, game.code)) return false; // les autres messages restent du chat normal
  end(game);
  game.winner = message.author.id;
  await message.react('🎉').catch(() => {});
  await message
    .reply({ content: `🎉 **Bravo ${message.author} !** C’était **${countryName(game.code)}** ${flagEmoji(game.code)}. ${reward(game, message.author.id)}`, ...quiet })
    .catch(() => {});
  await game.message.edit(payloadOf(game)).catch(() => {});
  return true;
}

// Pas de spam de « +flag » : pendant une partie du salon, ou moins de 20 s après le dernier lancement du membre, le
// message est supprimé. Le bot ne prévient qu'une fois (par partie, ou par attente), et son message s'efface.
const FLAG_COOLDOWN_MS = 20_000;
const NOTICE_MS = 5000;
const lastFlagStart = new Map(); // serveur:membre → dernier lancement
const warned = new Set();

async function blockFlagSpam(message) {
  const key = `${message.guild.id}:${message.author.id}`;
  const running = games.get(message.channelId);
  const wait = (lastFlagStart.get(key) ?? 0) + FLAG_COOLDOWN_MS - Date.now();
  if (!running && wait <= 0) return false;
  await message.delete().catch(() => {});
  const warnKey = running ? `${key}:partie:${running.message?.id}` : `${key}:attente:${lastFlagStart.get(key)}`;
  if (warned.has(warnKey)) return true;
  warned.add(warnKey);
  setTimeout(() => warned.delete(warnKey), 60_000);
  const notice = await message.channel
    .send({
      content: running
        ? `⏳ ${message.author}, une partie est déjà en cours ici : ${running.message?.url ?? 'trouve d’abord la réponse'}`
        : `⏳ ${message.author}, attends encore **${Math.ceil(wait / 1000)} s** avant de relancer \`+flag\`.`,
      allowedMentions: { parse: [] },
    })
    .catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => {}), NOTICE_MS);
  return true;
}

// Pas deux fois de suite la même devinette dans un salon.
const lastPuzzle = new Map();

async function start(message, kind, options = {}) {
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
  if (kind === 'flag') {
    const recent = recentFlags.get(channel.id) ?? [];
    const code = pickCode(recent);
    recentFlags.set(channel.id, [...recent, code].slice(-50));
    Object.assign(game, { code, hint: false, endsAt: Date.now() + FLAG_MS, view: () => flagView(game) });
  }
  games.set(channel.id, game);
  if (kind === 'pokemon') {
    // Tirage (sans les 30 derniers du salon), puis les images : la partie est réservée pendant le dessin.
    const recent = recentPokemon.get(channel.id) ?? [];
    const pool = POKEMON.filter((p) => (!options.gen || p[3] === options.gen) && !recent.includes(p[0]));
    const pokemon = pick(pool.length ? pool : POKEMON);
    recentPokemon.set(channel.id, [...recent, pokemon[0]].slice(-30));
    await channel.sendTyping().catch(() => {});
    const images = await pokemonImages(pokemon[0]);
    if (!images) {
      games.delete(channel.id);
      await message.reply({ content: '❌ Je n’ai pas pu charger l’image du Pokémon, réessaie.', ...quiet }).catch(() => {});
      return;
    }
    Object.assign(game, {
      pokemon,
      genFilter: options.gen ?? null,
      images,
      hint: false,
      endsAt: Date.now() + POKEMON_MS,
      view: () => pokemonView(game),
      payload: () => ({ embeds: [pokemonView(game)], files: [{ attachment: game.done ? images.reveal : images.silhouette, name: 'pokemon.png' }], attachments: [] }),
    });
  }
  const { attachments, ...first } = payloadOf(game);
  game.message = await channel.send({ ...first, allowedMentions: { parse: [] } }).catch(() => null);
  if (!game.message) return games.delete(channel.id);
  if (kind === 'flag') lastFlagStart.set(`${guild.id}:${message.author.id}`, Date.now());
  const timed = { emoji: [EMOJI_MS, EMOJI_HINT_MS], pokemon: [POKEMON_MS, POKEMON_HINT_MS], flag: [FLAG_MS, FLAG_HINT_MS] }[kind];
  if (timed) {
    armIdle(game, timed[0]);
    game.hintTimer = setTimeout(() => {
      if (game.done) return;
      game.hint = true;
      game.message.edit(payloadOf(game)).catch(() => {});
    }, timed[1]);
  } else armIdle(game);
}

// --- +jeux top [jeu] : classement des victoires (tous les jeux, ou un seul) ---
const GAME_INFO = { pendu: ['🪢', 'Pendu'], devine: ['🔢', 'Devine'], emoji: ['🧩', 'Emoji'], pokemon: ['❓', 'Pokémon'], flag: ['🏳️', 'Drapeaux'] };
const GAME_ALIASES = { drapeau: 'flag', drapeaux: 'flag', nombre: 'devine' };
const TOP_COMMAND = /^\+jeux(?:\s+top)?(?:\s+(\S+))?$/i;
const MEDALS = ['🥇', '🥈', '🥉'];

async function showTop(message, arg) {
  const key = arg ? normalize(arg).replace(/[^a-z]/g, '') : null;
  const only = key ? (GAME_INFO[key] ? key : GAME_ALIASES[key]) : null;
  if (key && !only) {
    await message.reply({ content: `❌ Jeu inconnu. Choisis parmi : ${Object.keys(GAME_INFO).map((k) => `\`${k}\``).join(', ')}.`, ...quiet }).catch(() => {});
    return;
  }
  const total = (s) => (only ? (s[only] ?? 0) : Object.values(s).reduce((a, b) => a + b, 0));
  const ranking = Object.entries(getChatGameStats(message.guild.id))
    .map(([id, s]) => ({ id, s, n: total(s) }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
  const detail = (s) =>
    Object.entries(GAME_INFO)
      .filter(([k]) => s[k])
      .map(([k, [emoji]]) => `${emoji} ${s[k]}`)
      .join(' · ');
  const lines = ranking.slice(0, 10).map((r, i) => `${MEDALS[i] ?? `**${i + 1}.**`} <@${r.id}> — **${r.n}** victoire(s)${only ? '' : ` · ${detail(r.s)}`}`);
  const mine = ranking.findIndex((r) => r.id === message.author.id);
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(only ? `🏆 Classement — ${GAME_INFO[only][0]} ${GAME_INFO[only][1]}` : '🏆 Classement des jeux du chat')
    .setDescription(
      lines.length
        ? lines.join('\n')
        : `Personne n’a encore gagné${only ? ' à ce jeu' : ''}… Lance une partie avec ${Object.keys(GAME_INFO).map((k) => `\`+${k}\``).join(', ')} !`,
    )
    .setFooter({
      text:
        (mine >= 10 ? `Toi : ${mine + 1}ᵉ avec ${ranking[mine].n} victoire(s) · ` : '') +
        (only ? '' : '🪢 pendu · 🔢 devine · 🧩 emoji · ❓ Pokémon · 🏳️ drapeaux · ') +
        '« +jeux top pendu » pour un seul jeu',
    });
  await message.reply({ embeds: [embed], ...quiet }).catch(() => {});
}

const STARTS = { '+pendu': 'pendu', '+devine': 'devine', '+emoji': 'emoji', '+flag': 'flag' };
const GUESS = { pendu: penduGuess, devine: devineGuess, emoji: emojiGuess, pokemon: pokemonGuess, flag: flagGuess };
const POKEMON_START = /^\+pok[eé]mon(?:\s+([1-9]))?$/i;

// Renvoie true si le message a servi au jeu (lancement ou essai) : il ne compte alors pas pour l'XP.
export async function handleChatGames(message) {
  if (!message.guild || message.author.bot) return false;
  const text = message.content.trim();
  const top = text.match(TOP_COMMAND);
  if (top) {
    await showTop(message, top[1]);
    return true;
  }
  const kind = STARTS[text.toLowerCase()];
  if (kind) {
    if (kind === 'flag' && (await blockFlagSpam(message))) return true;
    await start(message, kind);
    return true;
  }
  const poke = text.match(POKEMON_START);
  if (poke) {
    await start(message, 'pokemon', { gen: poke[1] ? Number(poke[1]) : null });
    return true;
  }
  const game = games.get(message.channelId);
  if (!game || game.done || !text) return false;
  return GUESS[game.kind](game, message, text);
}
