// Rôle automatique selon le statut personnalisé d'un membre.
// Ex : quelqu'un met « .gg/ximi » dans son statut → il reçoit un rôle,
// et le perd dès qu'il l'enlève.

// Concatène tout le texte visible de la présence (statut perso + activités).
function presenceText(presence) {
  if (!presence) return '';
  const parts = [];
  for (const a of presence.activities ?? []) {
    if (a.state) parts.push(a.state); // texte du statut personnalisé
    if (a.name) parts.push(a.name);
    if (a.details) parts.push(a.details);
  }
  return parts.join(' ').toLowerCase();
}

// Ajoute ou retire le rôle selon la présence du texte déclencheur dans le statut.
// Renvoie 'added' | 'removed' | null (aucun changement).
export async function applyStatusRole(member, config) {
  if (!member || member.user.bot || !config?.text || !config.roleId) return null;

  const trigger = config.text.toLowerCase();
  const matches = presenceText(member.presence).includes(trigger);
  const has = member.roles.cache.has(config.roleId);

  if (matches && !has) {
    await member.roles.add(config.roleId).catch(() => {});
    return 'added';
  }
  if (!matches && has) {
    await member.roles.remove(config.roleId).catch(() => {});
    return 'removed';
  }
  return null;
}

// Balaye tous les membres en cache d'un serveur et applique le rôle.
// Renvoie { added, removed }.
export async function sweepStatusRoles(guild, config) {
  let added = 0;
  let removed = 0;
  for (const [, member] of guild.members.cache) {
    const res = await applyStatusRole(member, config).catch(() => null);
    if (res === 'added') added += 1;
    else if (res === 'removed') removed += 1;
  }
  return { added, removed };
}

// Balaye tous les serveurs (utilisé au démarrage + périodiquement).
export async function sweepAllStatusRoles(client, getConfig) {
  for (const [, guild] of client.guilds.cache) {
    const config = getConfig(guild.id);
    if (config?.text && config.roleId) await sweepStatusRoles(guild, config).catch(() => {});
  }
}
