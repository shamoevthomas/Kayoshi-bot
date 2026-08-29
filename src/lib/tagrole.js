// Rôle automatique pour les membres qui portent le TAG du serveur
// (fonctionnalité « Server Tag » de Discord). Le rôle est retiré dès qu'ils
// changent de tag.
import { getTagRoleConfig } from './store.js';

// Le membre affiche-t-il le tag de CE serveur ?
export function wearsServerTag(member) {
  const pg = member?.user?.primaryGuild;
  return Boolean(pg?.identityEnabled && pg.identityGuildId === member.guild.id);
}

// Ajoute/retire le rôle selon le port du tag. Renvoie 'added' | 'removed' | null.
export async function applyTagRole(member, config) {
  if (!member || member.user.bot || !config?.roleId) return null;
  const has = member.roles.cache.has(config.roleId);
  const wears = wearsServerTag(member);
  if (wears && !has) {
    await member.roles.add(config.roleId).catch(() => {});
    return 'added';
  }
  if (!wears && has) {
    await member.roles.remove(config.roleId).catch(() => {});
    return 'removed';
  }
  return null;
}

export async function sweepTagRoles(guild, config) {
  let added = 0;
  let removed = 0;
  for (const [, member] of guild.members.cache) {
    const res = await applyTagRole(member, config).catch(() => null);
    if (res === 'added') added += 1;
    else if (res === 'removed') removed += 1;
  }
  return { added, removed };
}

export async function sweepAllTagRoles(client, getConfig = getTagRoleConfig) {
  for (const [, guild] of client.guilds.cache) {
    const config = getConfig(guild.id);
    if (config?.roleId) await sweepTagRoles(guild, config).catch(() => {});
  }
}
