import { EmbedBuilder } from 'discord.js';

// « kayo <action> @membre » (ou « hana … ») : câlin, bisou, caresse, bonk… avec un GIF d'anime au hasard
// (API gratuite nekos.best). Sans membre mentionné (ou soi-même), le bot répond à la personne. « kayo actions »
// liste toutes les actions.
const COMMAND = /^(?:kayo|hana)\s+([a-z]+)\b/i;
const COLORS = { tendre: 0xff8fab, taquin: 0xff8c42, humeur: 0x5dade2 };

// [couleur, emoji, avec une cible (a, b), sans cible (a)]
const ACTIONS = {
  hug: ['tendre', '🤗', (a, b) => `${a} fait un câlin à ${b} !`, (a) => `${a} a besoin d’un câlin… Kayoshi lui en fait un !`],
  kiss: ['tendre', '💋', (a, b) => `${a} fait un bisou à ${b} !`, (a) => `Kayoshi fait un bisou à ${a} !`],
  pat: ['tendre', '🫳', (a, b) => `${a} caresse la tête de ${b} !`, (a) => `Kayoshi caresse la tête de ${a} !`],
  cuddle: ['tendre', '🥰', (a, b) => `${a} se blottit contre ${b} !`, (a) => `Kayoshi vient se blottir contre ${a} !`],
  handhold: ['tendre', '🫶', (a, b) => `${a} prend la main de ${b} !`, (a) => `${a} tend la main… Kayoshi la prend !`],
  feed: ['tendre', '🍙', (a, b) => `${a} donne à manger à ${b} !`, (a) => `Kayoshi donne à manger à ${a} !`],
  peck: ['tendre', '😚', (a, b) => `${a} fait un petit bisou à ${b} !`, (a) => `Kayoshi fait un petit bisou à ${a} !`],
  blowkiss: ['tendre', '😘', (a, b) => `${a} envoie un bisou volant à ${b} !`, (a) => `${a} envoie des bisous volants à tout le monde !`],
  carry: ['tendre', '🫂', (a, b) => `${a} porte ${b} dans ses bras !`, (a) => `Kayoshi porte ${a} dans ses bras !`],
  lappillow: ['tendre', '😌', (a, b) => `${a} pose sa tête sur les genoux de ${b}.`, (a) => `${a} cherche des genoux pour faire la sieste…`],
  kabedon: ['tendre', '🧱', (a, b) => `${a} plaque ${b} contre le mur (kabedon) !`, (a) => `${a} fait un kabedon… dans le vide.`],
  wave: ['tendre', '👋', (a, b) => `${a} fait coucou à ${b} !`, (a) => `${a} fait coucou à tout le monde !`],
  handshake: ['tendre', '🤝', (a, b) => `${a} serre la main de ${b}.`, (a) => `${a} tend la main… Kayoshi la serre !`],
  highfive: ['tendre', '✋', (a, b) => `${a} tape m’en cinq avec ${b} !`, (a) => `${a} lève la main… Kayoshi tape dedans !`],
  salute: ['tendre', '🫡', (a, b) => `${a} salue ${b} !`, (a) => `${a} salue tout le monde !`],
  thumbsup: ['tendre', '👍', (a, b) => `${a} lève le pouce pour ${b} !`, (a) => `${a} lève le pouce !`],
  clap: ['tendre', '👏', (a, b) => `${a} applaudit ${b} !`, (a) => `${a} applaudit !`],
  slap: ['taquin', '👋', (a, b) => `${a} met une gifle à ${b} !`, (a) => `${a} se met une gifle… tout va bien ?`],
  bonk: ['taquin', '🔨', (a, b) => `${a} donne un bonk à ${b} !`, (a) => `Kayoshi donne un bonk à ${a} !`],
  poke: ['taquin', '👉', (a, b) => `${a} embête ${b} du bout du doigt !`, (a) => `${a} embête tout le monde du bout du doigt.`],
  tickle: ['taquin', '🤭', (a, b) => `${a} chatouille ${b} !`, (a) => `Kayoshi chatouille ${a} !`],
  bite: ['taquin', '😬', (a, b) => `${a} mord ${b} !`, (a) => `${a} a envie de mordre quelqu’un…`],
  punch: ['taquin', '👊', (a, b) => `${a} met un coup de poing à ${b} !`, (a) => `${a} frappe dans le vide !`],
  kick: ['taquin', '🦵', (a, b) => `${a} met un coup de pied à ${b} !`, (a) => `${a} donne des coups de pied dans le vide !`],
  shoot: ['taquin', '🔫', (a, b) => `${a} tire sur ${b} !`, (a) => `${a} tire en l’air !`],
  yeet: ['taquin', '🚀', (a, b) => `${a} envoie valser ${b} !`, (a) => `${a} envoie tout valser !`],
  shake: ['taquin', '🫨', (a, b) => `${a} secoue ${b} !`, (a) => `${a} se secoue !`],
  baka: ['taquin', '😤', (a, b) => `${a} traite ${b} de baka !`, (a) => `${a} crie « baka » !`],
  bleh: ['taquin', '😛', (a, b) => `${a} tire la langue à ${b} !`, (a) => `${a} tire la langue !`],
  smug: ['taquin', '😏', (a, b) => `${a} regarde ${b} d’un air supérieur.`, (a) => `${a} prend un air supérieur.`],
  laugh: ['taquin', '😂', (a, b) => `${a} se moque de ${b} !`, (a) => `${a} éclate de rire !`],
  teehee: ['taquin', '🤭', (a, b) => `${a} rigole en cachette de ${b}.`, (a) => `${a} rigole en cachette.`],
  nom: ['taquin', '😋', (a, b) => `${a} grignote ${b} !`, (a) => `${a} grignote quelque chose.`],
  lurk: ['taquin', '👀', (a, b) => `${a} observe ${b} en cachette…`, (a) => `${a} observe le salon en cachette…`],
  stare: ['taquin', '👁️', (a, b) => `${a} fixe ${b}…`, (a) => `${a} fixe le vide…`],
  wink: ['taquin', '😉', (a, b) => `${a} fait un clin d’œil à ${b} !`, (a) => `${a} fait un clin d’œil !`],
  tableflip: ['taquin', '🙃', (a, b) => `${a} renverse la table à cause de ${b} ! (╯°□°)╯︵ ┻━┻`, (a) => `${a} renverse la table ! (╯°□°)╯︵ ┻━┻`],
  run: ['taquin', '🏃', (a, b) => `${a} s’enfuit loin de ${b} !`, (a) => `${a} part en courant !`],
  spin: ['taquin', '🌀', (a, b) => `${a} tourne autour de ${b} !`, (a) => `${a} tourne sur place !`],
  wag: ['taquin', '🐶', (a, b) => `${a} remue la queue devant ${b} !`, (a) => `${a} remue la queue !`],
  nya: ['taquin', '🐱', (a, b) => `${a} fait « nya » à ${b} !`, (a) => `${a} fait « nya~ » !`],
  cry: ['humeur', '😢', (a, b) => `${a} pleure à cause de ${b}…`, (a) => `${a} pleure… Kayoshi lui fait un câlin.`],
  blush: ['humeur', '😳', (a, b) => `${a} rougit devant ${b} !`, (a) => `${a} rougit !`],
  dance: ['humeur', '💃', (a, b) => `${a} danse avec ${b} !`, (a) => `${a} danse !`],
  smile: ['humeur', '😊', (a, b) => `${a} sourit à ${b} !`, (a) => `${a} sourit !`],
  happy: ['humeur', '😄', (a, b) => `${a} saute de joie en voyant ${b} !`, (a) => `${a} saute de joie !`],
  sleep: ['humeur', '😴', (a, b) => `${a} s’endort sur ${b}…`, (a) => `${a} s’endort… bonne nuit !`],
  yawn: ['humeur', '🥱', (a, b) => `${a} bâille devant ${b}…`, (a) => `${a} bâille…`],
  bored: ['humeur', '😑', (a, b) => `${a} s’ennuie avec ${b}…`, (a) => `${a} s’ennuie…`],
  facepalm: ['humeur', '🤦', (a, b) => `${a} fait un facepalm à cause de ${b}.`, (a) => `${a} fait un facepalm.`],
  shrug: ['humeur', '🤷', (a, b) => `${a} hausse les épaules face à ${b}.`, (a) => `${a} hausse les épaules.`],
  think: ['humeur', '🤔', (a, b) => `${a} réfléchit à propos de ${b}…`, (a) => `${a} réfléchit…`],
  confused: ['humeur', '😕', (a, b) => `${a} ne comprend rien à ${b}…`, (a) => `${a} ne comprend plus rien…`],
  shocked: ['humeur', '😱', (a, b) => `${b} met ${a} sous le choc !`, (a) => `${a} est sous le choc !`],
  angry: ['humeur', '😠', (a, b) => `${a} est en colère contre ${b} !`, (a) => `${a} est en colère !`],
  pout: ['humeur', '😗', (a, b) => `${a} boude ${b}.`, (a) => `${a} boude.`],
  nod: ['humeur', '😌', (a, b) => `${a} approuve ${b} d’un signe de tête.`, (a) => `${a} hoche la tête.`],
  nope: ['humeur', '🙅', (a, b) => `${a} dit non à ${b} !`, (a) => `${a} dit non !`],
  sip: ['humeur', '☕', (a, b) => `${a} sirote son thé en regardant ${b}…`, (a) => `${a} sirote son thé…`],
};
const GROUPS = { tendre: '💗 Tendres', taquin: '😜 Taquines', humeur: '💭 Humeur' };

// GIF au hasard pour l'action, ou null si l'API ne répond pas.
async function randomGif(action) {
  try {
    const res = await fetch(`https://nekos.best/api/v2/${action}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    return (await res.json()).results?.[0] ?? null;
  } catch {
    return null;
  }
}

function listEmbed() {
  const embed = new EmbedBuilder()
    .setColor(COLORS.tendre)
    .setTitle('🎭 Actions avec un GIF d’anime')
    .setDescription('Écris `kayo <action> @membre` (ou `hana <action>`), par exemple `kayo pat @membre`. Sans membre, Kayoshi te répond.');
  for (const [group, title] of Object.entries(GROUPS)) {
    const names = Object.entries(ACTIONS).filter(([, a]) => a[0] === group).map(([name, a]) => `${a[1]} \`${name}\``);
    embed.addFields({ name: title, value: names.join(' · ') });
  }
  return embed;
}

export async function handleActionCommand(message) {
  if (!message.guild || message.author.bot) return false;
  const match = message.content.trim().match(COMMAND);
  if (!match) return false;
  const action = match[1].toLowerCase();
  if (action === 'actions') {
    await message.reply({ embeds: [listEmbed()], allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
    return true;
  }
  if (!ACTIONS[action]) return false;
  const [group, emoji, to, alone] = ACTIONS[action];
  const target = message.mentions.users.find((u) => u.id !== message.author.id) ?? null;

  const embed = new EmbedBuilder().setColor(COLORS[group]).setDescription(`${emoji} ${target ? to(message.author, target) : alone(message.author)}`);
  const gif = await randomGif(action);
  if (gif?.url) embed.setImage(gif.url);
  if (gif?.anime_name) embed.setFooter({ text: `Anime : ${gif.anime_name}` });
  // Pas de nouveau ping : la personne a déjà été mentionnée dans le message.
  await message.channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}
