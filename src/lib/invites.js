// Suivi des invitations : on garde en mémoire le nombre d'utilisations de chaque
// invitation par serveur, pour déterminer laquelle a servi à un nouvel arrivant.
// Comparer l'état "avant" et "après" une arrivée révèle l'invitation dont le
// compteur a augmenté (donc celle utilisée).
// Structure : Map<guildId, Map<code, { uses, inviter, vanity }>>
const cache = new Map();

// Récupère l'état courant des invitations d'un serveur (usages + créateur).
async function fetchInviteMap(guild) {
  const map = new Map();
  try {
    const invites = await guild.invites.fetch();
    invites.forEach((inv) =>
      map.set(inv.code, { uses: inv.uses ?? 0, inviter: inv.inviter ?? null }),
    );
  } catch {
    // Le bot n'a pas la permission "Gérer le serveur" : suivi indisponible.
  }
  // Lien personnalisé (vanity) éventuel, ex. discord.gg/ximi.
  if (guild.vanityURLCode) {
    const vanity = await guild.fetchVanityData().catch(() => null);
    if (vanity) map.set(guild.vanityURLCode, { uses: vanity.uses ?? 0, inviter: null, vanity: true });
  }
  return map;
}

// (Re)charge le cache d'un serveur. À appeler au démarrage et quand le bot rejoint un serveur.
export async function cacheGuildInvites(guild) {
  cache.set(guild.id, await fetchInviteMap(guild));
}

// Charge le cache de tous les serveurs connus.
export async function cacheAllInvites(client) {
  for (const [, guild] of client.guilds.cache) await cacheGuildInvites(guild);
}

// Maintient le cache à jour quand une invitation est créée / supprimée.
export function trackInviteCreate(invite) {
  const map = cache.get(invite.guild.id) ?? new Map();
  map.set(invite.code, { uses: invite.uses ?? 0, inviter: invite.inviter ?? null });
  cache.set(invite.guild.id, map);
}

export function trackInviteDelete(invite) {
  cache.get(invite.guild?.id)?.delete(invite.code);
}

// Compare l'état courant au cache pour trouver l'invitation utilisée par un arrivant.
// Renvoie { code, inviter, vanity } ou null si indéterminable. Rafraîchit le cache.
export async function detectUsedInvite(guild) {
  const before = cache.get(guild.id) ?? new Map();
  const after = await fetchInviteMap(guild);
  cache.set(guild.id, after);

  // Cas normal : une invitation dont le compteur d'utilisations a augmenté.
  for (const [code, info] of after) {
    const prev = before.get(code)?.uses ?? 0;
    if (info.uses > prev) return { code, inviter: info.inviter, vanity: info.vanity ?? false };
  }
  // Invitation à usage unique : elle a atteint sa limite et a disparu depuis le cache.
  for (const [code, info] of before) {
    if (!after.has(code) && !info.vanity) return { code, inviter: info.inviter, vanity: false };
  }
  return null;
}
