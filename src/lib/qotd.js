import { EmbedBuilder } from 'discord.js';
import { getQotd, setQotd } from './store.js';

// Question du jour (/quiz question-du-jour) : chaque jour à l'heure choisie (heure de Paris), une question
// ouverte dans le salon choisi, avec un rôle mentionné, puis un fil pour les réponses. Les questions ne
// reviennent qu'une fois toutes posées. Réglages : data[guildId].qotd = { enabled, channelId, roleId,
// hour, lastDay, used: [indices] }.
export const QUESTIONS = [
  'Quel est ton anime préféré de tous les temps, et pourquoi ?',
  'Si tu pouvais vivre dans l’univers d’un jeu vidéo, lequel choisirais-tu ?',
  'Quelle est la musique que tu écoutes en boucle en ce moment ?',
  'Quel super-pouvoir aimerais-tu avoir ?',
  'Ton plat préféré, celui que tu pourrais manger tous les jours ?',
  'Quel est le meilleur film que tu aies vu cette année ?',
  'Si tu gagnais 1 million demain, quelle serait la première chose que tu ferais ?',
  'Chat ou chien ? Défends ton camp !',
  'Quel est le pays que tu rêves de visiter ?',
  'Quelle série as-tu regardée d’une traite ?',
  'Quel est ton personnage de fiction préféré ?',
  'Si tu pouvais parler une langue de plus d’un coup, laquelle ?',
  'Ton jeu vidéo d’enfance préféré ?',
  'Plutôt matin ou plutôt nuit ?',
  'Quelle est la chose la plus bizarre que tu aies mangée ?',
  'Quel métier aurais-tu voulu faire quand tu étais petit ?',
  'Si tu étais un emoji, lequel serais-tu ?',
  'Quel est le dernier truc qui t’a fait rire aux larmes ?',
  'Pizza à l’ananas : oui ou non ?',
  'Quel est l’album que tout le monde devrait écouter au moins une fois ?',
  'Si tu pouvais rencontrer une célébrité, ce serait qui ?',
  'Quel est ton opening d’anime préféré ?',
  'Tu préfères la plage ou la montagne ?',
  'Quelle est ta saison préférée et pourquoi ?',
  'Quel objet emporterais-tu sur une île déserte ?',
  'Quel est le meilleur conseil qu’on t’ait donné ?',
  'Quel manga conseillerais-tu à quelqu’un qui n’en a jamais lu ?',
  'Si tu pouvais remonter le temps, à quelle époque irais-tu ?',
  'Quel est ton jeu mobile du moment ?',
  'Quelle est ta boisson préférée ?',
  'Quel est le film qui t’a le plus fait peur ?',
  'Quelle compétence aimerais-tu apprendre cette année ?',
  'Quel est ton snack préféré pour une soirée film ?',
  'Si tu avais un animal de compagnie fantastique, ce serait quoi ?',
  'Quel est ton personnage de jeu vidéo préféré ?',
  'Quelle est la meilleure saison d’une série, selon toi ?',
  'Quel est le plus beau paysage que tu aies vu ?',
  'Team sucré ou team salé ?',
  'Quel dessin animé de ton enfance regardes-tu encore avec plaisir ?',
  'Si tu pouvais avoir un don artistique, lequel ?',
  'Quelle est l’appli que tu ouvres le plus sur ton téléphone ?',
  'Quel est ton souvenir d’école préféré ?',
  'Si tu devais écouter un seul artiste pour le reste de ta vie ?',
  'Quel est le meilleur méchant de l’histoire des animes ?',
  'Tu préfères lire le livre ou voir le film ?',
  'Quel est le dernier jeu auquel tu as joué ?',
  'Quelle est ta citation préférée ?',
  'Si tu pouvais changer une chose dans le monde, ce serait quoi ?',
  'Quel est ton combo de tenue préféré ?',
  'Quel est ton plus grand talent caché ?',
  'Quelle est la chose qui te rend instantanément de bonne humeur ?',
  'Si ta vie était un anime, quel serait son titre ?',
  'Quelle est ta chanson pour te motiver ?',
  'Quel est le meilleur dessert du monde ?',
  'Tu préfères voyager dans le futur ou dans le passé ?',
  'Quel est le jeu de société que tu préfères ?',
  'Quelle série animée occidentale préfères-tu ?',
  'Si tu pouvais dîner avec un personnage de fiction, lequel ?',
  'Quel est ton genre musical préféré ?',
  'Quel est le meilleur moment de ta semaine ?',
  'Quel est ton studio d’animation préféré ?',
  'Si tu pouvais te téléporter n’importe où maintenant, où irais-tu ?',
  'Quel est le dernier achat dont tu es vraiment content ?',
  'Quelle est ta couleur préférée ?',
  'Quel est le meilleur jeu vidéo de tous les temps ?',
  'Quelle est la chanson que tu chantes sous la douche ?',
  'Quel est ton héros (réel ou fictif) ?',
  'Quel est ton fast-food préféré ?',
  'Si tu devais vivre dans une ville d’un autre pays, laquelle ?',
  'Quelle est la meilleure fin de série que tu aies vue ?',
  'Qu’est-ce qui te stresse le plus ?',
  'Quel est ton rituel du dimanche ?',
  'Quel sport aimes-tu regarder ou pratiquer ?',
  'Quelle est ta plus grande fierté ?',
  'Si tu pouvais créer un jeu vidéo, il parlerait de quoi ?',
  'Quel est l’ending d’anime que tu ne passes jamais ?',
  'Tu préfères un film d’horreur ou une comédie ?',
  'Quel est le plus long que tu sois resté devant un jeu sans t’arrêter ?',
  'Quelle est ta recette signature ?',
  'Quel est le surnom le plus drôle qu’on t’ait donné ?',
  'Si tu pouvais être un personnage d’anime pendant une journée ?',
  'Quelle est la meilleure collab musicale de tous les temps ?',
  'Quel est ton YouTubeur ou streamer préféré ?',
  'Qu’est-ce que tu ne pourrais jamais abandonner ?',
  'Quel est ton héros de Marvel ou DC préféré ?',
  'Quelle est ta plus grande peur (pas trop grave) ?',
  'Si tu pouvais maîtriser un instrument instantanément ?',
  'Quel est ton Pokémon préféré ?',
  'Quelle est la meilleure chose qui te soit arrivée cette semaine ?',
  'Si tu étais un animal, lequel serais-tu ?',
  'Quel est ton parfum de glace préféré ?',
  'Quel est le webtoon ou manhwa que tu recommandes ?',
  'Quel est le film que tu peux revoir 100 fois ?',
  'Quelle est ta façon préférée de te détendre ?',
  'Si tu pouvais avoir un robot pour une tâche, laquelle ?',
  'Quel est ton personnage le plus détesté dans une série ?',
  'Quel est le meilleur jeu à jouer entre amis ?',
  'Qu’est-ce qui te rend unique ?',
  'Si tu pouvais changer de prénom, lequel prendrais-tu ?',
  'Quel est ton souvenir de vacances préféré ?',
  'Quelle est la meilleure invention de tous les temps ?',
  'Quel est ton sticker ou emoji Discord le plus utilisé ?',
  'Si tu pouvais assister à n’importe quel concert ?',
  'Quel est l’anime le plus sous-coté selon toi ?',
  'Quelle est ta plus grande qualité ?',
  'Plutôt jeux solo ou multijoueur ?',
  'Quelle habitude aimerais-tu prendre ?',
  'Quel est le meilleur combat de l’histoire des animes ?',
  'Si tu pouvais vivre dans une maison de film, laquelle ?',
  'Quel est le meilleur goûter de ton enfance ?',
  'Quel est le dernier livre ou manga que tu as fini ?',
  'Si tu pouvais avoir une réponse à n’importe quelle question, laquelle ?',
  'Quel est ton moment préféré de la journée ?',
  'Quel est ton jeu de combat ou de course préféré ?',
  'Quelle tendance ne comprends-tu pas du tout ?',
  'Si tu pouvais ajouter un jour férié, il fêterait quoi ?',
  'Quel est le plus beau compliment qu’on t’ait fait ?',
  'Quel est ton genre d’anime préféré (shōnen, slice of life…) ?',
  'Quelle est la chose la plus courageuse que tu aies faite ?',
  'Si tu pouvais avoir le look d’un personnage, lequel ?',
  'Quel est ton salon préféré sur ce serveur ?',
  'Quel est le meilleur souvenir que tu as sur ce serveur ?',
  'Si tu étais admin du serveur pour une journée, que changerais-tu ?',
];

const parisHour = () =>
  Number(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hourCycle: 'h23' }).formatToParts(new Date()).find((p) => p.type === 'hour').value);
const parisDay = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Paris' }); // AAAA-MM-JJ

function pickQuestion(cfg) {
  let used = cfg.used ?? [];
  if (used.length >= QUESTIONS.length) used = [];
  const free = QUESTIONS.map((_, i) => i).filter((i) => !used.includes(i));
  const index = free[Math.floor(Math.random() * free.length)];
  return { index, used: [...used, index] };
}

// Envoie la question du jour (et ouvre le fil). Renvoie le message, ou null.
export async function postQotd(guild) {
  const cfg = getQotd(guild.id);
  const channel = cfg?.channelId && (guild.channels.cache.get(cfg.channelId) ?? (await guild.channels.fetch(cfg.channelId).catch(() => null)));
  if (!channel?.isTextBased?.()) return null;
  const { index, used } = pickQuestion(cfg);
  setQotd(guild.id, { ...cfg, lastDay: parisDay(), used });
  const date = new Date().toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long' });
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('❓ Question du jour')
    .setDescription(`**${QUESTIONS[index]}**`)
    .setFooter({ text: `${date} · réponds dans le fil juste en dessous 👇` });
  let ping = { allowedMentions: { parse: [] } };
  if (cfg.roleId === guild.id) ping = { content: '@everyone', allowedMentions: { parse: ['everyone'] } };
  else if (cfg.roleId) ping = { content: `<@&${cfg.roleId}>`, allowedMentions: { roles: [cfg.roleId] } };
  const message = await channel.send({ ...ping, embeds: [embed] }).catch(() => null);
  if (!message) return null;
  // Fil des réponses, fermé automatiquement au bout de 24 h sans message.
  await message.startThread({ name: `💬 Réponses du ${date}`, autoArchiveDuration: 1440 }).catch(() => {});
  return message;
}

// Chaque minute : une question par jour, à l'heure choisie (ou dès que possible après, si le bot redémarrait).
export async function qotdTick(client) {
  const hour = parisHour();
  const today = parisDay();
  for (const guild of client.guilds.cache.values()) {
    const cfg = getQotd(guild.id);
    if (!cfg?.enabled || cfg.lastDay === today || hour < (cfg.hour ?? 18)) continue;
    await postQotd(guild).catch((err) => console.error('[question du jour]', err));
  }
}
