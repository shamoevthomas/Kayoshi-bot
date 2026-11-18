import { OverwriteType, PermissionFlagsBits } from 'discord.js';
import { getGuildConfig, setGuildConfig } from './store.js';

// Joueurs réduits au silence dans le salon d'une partie (undercover : en dehors de son tour ; loup-garou : la nuit).
// La permission « Envoyer des messages » leur est refusée à eux seuls, sans toucher au reste du salon, puis remise
// comme avant. Un joueur que la permission ne bloque pas (administrateur…) voit son message supprimé.
// Noté dans data[guildId].gameMutes = { channelId: { userId: avant } } (avant = true / false / null : la permission
// qu'il avait dans ce salon) pour tout rendre si le bot redémarre en pleine partie (restoreGameMutes).
const muted = new Map(); // channelId → Map(userId → avant)
const deletedHere = new Set(); // messages supprimés ici : ni log ni +snipe

const before = (channel, userId) => {
  const overwrite = channel.permissionOverwrites.cache.get(userId);
  if (overwrite?.allow.has(PermissionFlagsBits.SendMessages)) return true;
  if (overwrite?.deny.has(PermissionFlagsBits.SendMessages)) return false;
  return null;
};

function save(channel) {
  const all = { ...(getGuildConfig(channel.guild.id).gameMutes ?? {}) };
  const players = muted.get(channel.id);
  if (players?.size) all[channel.id] = Object.fromEntries(players);
  else delete all[channel.id];
  setGuildConfig(channel.guild.id, { gameMutes: all });
}

async function setSend(channel, userId, value, reason) {
  await channel.permissionOverwrites.edit(userId, { SendMessages: value }, { reason, type: OverwriteType.Member });
  // Plus rien dans la permission du joueur : elle est retirée.
  const overwrite = channel.permissionOverwrites.cache.get(userId);
  if (overwrite && !overwrite.allow.bitfield && !overwrite.deny.bitfield) await overwrite.delete(reason).catch(() => {});
}

// La liste est mise à jour tout de suite (avant les appels à Discord) : un message envoyé entre-temps est déjà bloqué.
export async function mutePlayers(channel, userIds, reason) {
  let players = muted.get(channel.id);
  if (!players) muted.set(channel.id, (players = new Map()));
  const todo = userIds.filter((id) => !players.has(id));
  if (!todo.length) return;
  for (const id of todo) players.set(id, before(channel, id));
  save(channel);
  await Promise.all(todo.map((id) => setSend(channel, id, false, reason).catch(() => {})));
}

export async function unmutePlayers(channel, userIds, reason) {
  const players = muted.get(channel.id);
  if (!players) return;
  const todo = userIds.filter((id) => players.has(id)).map((id) => [id, players.get(id)]);
  if (!todo.length) return;
  for (const [id] of todo) players.delete(id);
  if (!players.size) muted.delete(channel.id);
  save(channel);
  await Promise.all(todo.map(([id, value]) => setSend(channel, id, value, reason).catch(() => {})));
}

export const unmuteAll = (channel, reason) => unmutePlayers(channel, [...(muted.get(channel.id)?.keys() ?? [])], reason);

// messageCreate : message d'un joueur réduit au silence → supprimé.
export async function handleMutedPlayerMessage(message) {
  if (!message.guild || message.author.bot || !muted.get(message.channelId)?.has(message.author.id)) return false;
  deletedHere.add(message.id);
  if (deletedHere.size > 500) deletedHere.delete(deletedHere.values().next().value);
  await message.delete().catch(() => deletedHere.delete(message.id));
  return true;
}

// messageDelete : true si le message a été supprimé ici (pas de log).
export const deletedByGameMute = (messageId) => deletedHere.delete(messageId);

// Au démarrage : les parties en mémoire sont perdues, la parole est rendue à tous ceux qui l'avaient perdue.
export async function restoreGameMutes(client) {
  for (const guild of client.guilds.cache.values()) {
    const all = getGuildConfig(guild.id).gameMutes;
    if (!all || !Object.keys(all).length) continue;
    for (const [channelId, players] of Object.entries(all)) {
      const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
      if (!channel) continue;
      for (const [id, value] of Object.entries(players)) {
        await setSend(channel, id, value, 'Partie interrompue (redémarrage du bot) : parole rendue').catch(() => {});
      }
    }
    setGuildConfig(guild.id, { gameMutes: {} });
  }
}
