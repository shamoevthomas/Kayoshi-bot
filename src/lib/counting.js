import { getCounting, setCounting } from './store.js';

// Comptage (/compteur) : dans le salon choisi, les membres écrivent 1, 2, 3… à tour de rôle, sans fin
// (BigInt : aucune limite de taille). Un message qui commence par un nombre compte ; le reste est de la
// discussion et n'est pas touché. Mauvais nombre, ou deux fois de suite le même membre : on repart à 1.
const NUMBER = /^(\d+)(?!\S)/;

export async function handleCountingMessage(message) {
  if (!message.guild || message.author.bot) return;
  const cfg = getCounting(message.guild.id);
  if (!cfg?.channelId || cfg.channelId !== message.channelId) return;
  const match = message.content.trim().match(NUMBER);
  if (!match) return;

  const current = BigInt(cfg.current ?? '0');
  const expected = current + 1n;
  const said = BigInt(match[1]);
  let problem = null;
  if (message.author.id === cfg.lastUserId) problem = 'on ne compte pas deux fois de suite';
  else if (said !== expected) problem = `il fallait écrire **${expected}**`;

  if (!problem) {
    const record = BigInt(cfg.record ?? '0');
    setCounting(message.guild.id, {
      ...cfg,
      current: said.toString(),
      lastUserId: message.author.id,
      record: (said > record ? said : record).toString(),
    });
    // 💯 à chaque centaine, ✅ sinon.
    await message.react(said % 100n === 0n ? '💯' : '✅').catch(() => {});
    return;
  }

  setCounting(message.guild.id, { ...cfg, current: '0', lastUserId: null });
  await message.react('❌').catch(() => {});
  const text =
    current === 0n
      ? `❌ ${message.author}, ${problem} : on commence par **1** !`
      : `❌ ${message.author} a cassé la série à **${current}** : ${problem}. On recommence à **1** ! (record : **${cfg.record ?? current}**)`;
  await message.channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
}
