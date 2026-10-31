import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getQuotes, setQuotes } from './store.js';
import { renderQuote } from './quote.js';

// Livre des citations du serveur : réagir 📖 sous un message l'ajoute au livre (une fois par message ; le texte
// est gardé même si le message est supprimé ensuite). « +citation » en ressort une au hasard, en image ;
// « +citation <n> », « +citation @membre », « +citation top », « +citation supprimer <n> » (staff).
const EMOJI = '📖';
const MAX_QUOTES = 1000;
const MAX_TEXT = 1000;
const COOLDOWN_MS = 3000;
const COMMAND = /^\+citations?(?:\s+(.*))?$/i;
const lastUse = new Map();
const DEFAULT_STYLE = { light: false, color: false, bold: false, serif: false };
const quiet = { allowedMentions: { parse: [], repliedUser: false } };
const cleanText = (message) => (message.cleanContent ?? '').replace(/<a?:(\w+):\d+>/g, ':$1:').trim();

// Réaction 📖 : ajoute le message au livre.
export async function handleQuoteReaction(reaction, user) {
  if (reaction.emoji.name !== EMOJI) return;
  if (user.partial) user = await user.fetch().catch(() => user);
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => null);
  const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
  if (!message?.guild || !message.author || message.author.bot || message.webhookId) return;
  const text = cleanText(message);
  if (!text) return; // image seule : rien à citer
  const book = getQuotes(message.guild.id);
  if (book.list.some((q) => q.messageId === message.id)) return; // déjà dans le livre
  const quote = {
    n: book.next,
    messageId: message.id,
    channelId: message.channelId,
    authorId: message.author.id,
    name: message.member?.displayName ?? message.author.globalName ?? message.author.username,
    username: message.author.username,
    avatar: (message.member ?? message.author).displayAvatarURL({ extension: 'png', size: 1024, forceStatic: true }),
    content: text.slice(0, MAX_TEXT),
    at: message.createdTimestamp,
    addedBy: user.id,
    addedAt: Date.now(),
  };
  setQuotes(message.guild.id, { next: book.next + 1, list: [...book.list, quote].slice(-MAX_QUOTES) });
  const note = await message
    .reply({ content: `${EMOJI} **Citation n°${quote.n}** ajoutée au livre par ${user} — \`+citation ${quote.n}\` pour la revoir.`, ...quiet })
    .catch(() => null);
  if (note) setTimeout(() => note.delete().catch(() => {}), 10_000);
}

// Image d'une citation : l'auteur tel qu'il est aujourd'hui s'il est encore là, sinon tel qu'il était.
async function quoteImage(guild, quote) {
  const member = guild.members.cache.get(quote.authorId) ?? (await guild.members.fetch(quote.authorId).catch(() => null));
  const author = member?.user ?? { username: quote.username, globalName: quote.name, displayAvatarURL: () => quote.avatar };
  return renderQuote({ cleanContent: quote.content, member, author }, DEFAULT_STYLE);
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

export async function handleQuoteBookCommand(message) {
  if (!message.guild || message.author.bot) return false;
  const match = message.content.trim().match(COMMAND);
  if (!match) return false;
  const { guild } = message;
  const key = `${guild.id}:${message.author.id}`;
  if (Date.now() - (lastUse.get(key) ?? 0) < COOLDOWN_MS) return true;
  lastUse.set(key, Date.now());
  const reply = (payload) => message.reply({ ...quiet, ...payload }).catch(() => {});
  const arg = (match[1] ?? '').trim();
  const book = getQuotes(guild.id);

  // Retirer une citation (staff).
  const removal = arg.match(/^(?:supprimer|suppr|retirer|delete)\s+(\d+)$/i);
  if (removal) {
    if (!message.member?.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
    const n = Number(removal[1]);
    if (!book.list.some((q) => q.n === n)) return reply({ content: `❌ Pas de citation n°${n}.` }).then(() => true);
    setQuotes(guild.id, { ...book, list: book.list.filter((q) => q.n !== n) });
    await reply({ content: `🗑️ Citation n°${n} retirée du livre.` });
    return true;
  }

  if (!book.list.length) {
    await reply({ content: `${EMOJI} Le livre des citations est vide : réagis avec ${EMOJI} sous un message mémorable pour l’y ajouter.` });
    return true;
  }

  // Les membres les plus cités.
  if (/^top$/i.test(arg)) {
    const counts = {};
    for (const q of book.list) counts[q.authorId] = (counts[q.authorId] ?? 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    const medals = ['🥇', '🥈', '🥉'];
    await reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle(`${EMOJI} Les plus cités du livre`)
          .setDescription(top.map(([id, n], i) => `${medals[i] ?? `**${i + 1}.**`} <@${id}> — **${n}** citation(s)`).join('\n'))
          .setFooter({ text: `${book.list.length} citation(s) dans le livre · réagis ${EMOJI} pour en ajouter` }),
      ],
    });
    return true;
  }

  let quote;
  const memberId = arg.match(/^<@!?(\d+)>$/)?.[1] ?? arg.match(/^(\d{17,20})$/)?.[1];
  if (/^\d{1,6}$/.test(arg)) {
    quote = book.list.find((q) => q.n === Number(arg));
    if (!quote) return reply({ content: `❌ Pas de citation n°${arg} (elles vont de n°${book.list[0].n} à n°${book.list.at(-1).n}).` }).then(() => true);
  } else if (memberId) {
    const theirs = book.list.filter((q) => q.authorId === memberId);
    if (!theirs.length) return reply({ content: `${EMOJI} Aucune citation de <@${memberId}> dans le livre pour l’instant.` }).then(() => true);
    quote = pick(theirs);
  } else quote = pick(book.list);

  await message.channel.sendTyping().catch(() => {});
  const link = `https://discord.com/channels/${guild.id}/${quote.channelId}/${quote.messageId}`;
  await reply({
    content: `${EMOJI} **Citation n°${quote.n}** · <t:${Math.floor(quote.at / 1000)}:D> · ajoutée par <@${quote.addedBy}> · [voir le message](${link})`,
    files: [await quoteImage(guild, quote)],
  });
  return true;
}
