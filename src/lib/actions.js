import { EmbedBuilder } from 'discord.js';

// « kayo hug @membre » (ou « hana hug ») : câlin, bisou ou gifle, avec un GIF d'anime au hasard
// (API gratuite nekos.best). Sans membre mentionné (ou soi-même), le bot répond à la personne.
const COMMAND = /^(?:kayo|hana)\s+(hug|kiss|slap)\b/i;
const ACTIONS = {
  hug: { color: 0xffb6c1, to: (a, b) => `🤗 ${a} fait un câlin à ${b} !`, alone: (a) => `🤗 ${a} a besoin d’un câlin… Kayoshi lui en fait un !` },
  kiss: { color: 0xff6b9d, to: (a, b) => `💋 ${a} fait un bisou à ${b} !`, alone: (a) => `💋 Kayoshi fait un bisou à ${a} !` },
  slap: { color: 0xff8c42, to: (a, b) => `👋 ${a} met une gifle à ${b} !`, alone: (a) => `👋 ${a} se met une gifle… tout va bien ?` },
};

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

export async function handleActionCommand(message) {
  if (!message.guild || message.author.bot) return false;
  const match = message.content.trim().match(COMMAND);
  if (!match) return false;
  const action = match[1].toLowerCase();
  const { color, to, alone } = ACTIONS[action];
  const target = message.mentions.users.find((u) => u.id !== message.author.id) ?? null;

  const embed = new EmbedBuilder().setColor(color).setDescription(target ? to(message.author, target) : alone(message.author));
  const gif = await randomGif(action);
  if (gif?.url) embed.setImage(gif.url);
  if (gif?.anime_name) embed.setFooter({ text: `Anime : ${gif.anime_name}` });
  // Pas de nouveau ping : la personne a déjà été mentionnée dans le message.
  await message.channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
  return true;
}
