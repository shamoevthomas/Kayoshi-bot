import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { sendLog } from './logger.js';
import { CROWN_ROLE_ID } from './massdm.js';

// « Utiliser des applications externes » (Hanami) : réservée au rôle Crown. Aucun autre rôle ne la garde, ni dans
// ses permissions ni dans celles d'un salon (autorisation donnée à un rôle ou à un membre) : retirée au démarrage,
// puis dès qu'un rôle ou un salon la reçoit. Seule l'autorisation est enlevée, rien n'est interdit à la place.
// Les rôles des bots (gérés par une intégration) ne peuvent pas être modifiés ; un rôle Administrateur a toutes les
// permissions quoi qu'il arrive : il est seulement signalé.
const HANAMI = '1563159382361907350';
const EXTERNAL_APPS = PermissionFlagsBits.UseExternalApps;
const REASON = '« Utiliser des applications externes » réservée au rôle Crown';
const COLOR = 0xe67e22;

const enforced = (guild) => guild?.id === HANAMI;
const hasBit = (bits) => (bits & EXTERNAL_APPS) === EXTERNAL_APPS;

// Retire la permission à un rôle. Renvoie 'removed', 'failed', ou null (rien à faire).
async function stripRole(role) {
  if (role.id === CROWN_ROLE_ID || role.managed || !hasBit(role.permissions.bitfield)) return null;
  if (!role.editable) return 'failed';
  return role
    .setPermissions(role.permissions.bitfield & ~EXTERNAL_APPS, REASON)
    .then(() => 'removed')
    .catch(() => 'failed');
}

// Retire l'autorisation dans les permissions d'un salon (sauf pour le rôle Crown). Renvoie { removed, failed }.
async function stripChannel(channel) {
  const stats = { removed: 0, failed: 0 };
  if (!channel.permissionOverwrites) return stats;
  for (const o of channel.permissionOverwrites.cache.values()) {
    if (!hasBit(o.allow.bitfield) || o.id === CROWN_ROLE_ID) continue;
    const ok = await channel.permissionOverwrites
      .edit(o.id, { UseExternalApps: null }, { type: o.type, reason: REASON })
      .then(() => true)
      .catch(() => false);
    stats[ok ? 'removed' : 'failed']++;
  }
  return stats;
}

const roleName = (guild, id) => (id === guild.id ? '@everyone' : `<@&${id}>`);

async function report(guild, lines) {
  await sendLog(
    guild,
    new EmbedBuilder().setColor(COLOR).setAuthor({ name: '🧩 Applications externes' }).setDescription(lines.join('\n').slice(0, 4000)).setFooter({ text: 'Réservée au rôle Crown.' }).setTimestamp(),
  );
}

// Au démarrage : tous les rôles et tous les salons du serveur.
export async function sweepExternalApps(client) {
  const guild = client.guilds.cache.get(HANAMI);
  if (!guild) return;
  const removedRoles = [];
  const failedRoles = [];
  for (const role of guild.roles.cache.values()) {
    const result = await stripRole(role);
    if (result === 'removed') removedRoles.push(role.id);
    else if (result === 'failed') failedRoles.push(role.id);
  }
  let removed = 0;
  let failed = 0;
  const channels = [];
  for (const channel of guild.channels.cache.values()) {
    const stats = await stripChannel(channel);
    removed += stats.removed;
    failed += stats.failed;
    if (stats.removed) channels.push(channel.id);
  }
  if (!removedRoles.length && !failedRoles.length && !removed && !failed) return;

  const admins = guild.roles.cache.filter((r) => r.id !== CROWN_ROLE_ID && !r.managed && r.permissions.has(PermissionFlagsBits.Administrator));
  const lines = [];
  if (removedRoles.length) lines.push(`✅ Retirée de **${removedRoles.length}** rôle(s) : ${removedRoles.map((id) => roleName(guild, id)).join(', ')}`);
  if (removed) lines.push(`✅ Retirée dans les permissions de **${channels.length}** salon(s) (${removed} autorisation(s)) : ${channels.map((id) => `<#${id}>`).join(', ')}`);
  if (failedRoles.length) lines.push(`⚠️ Impossible pour ${failedRoles.map((id) => roleName(guild, id)).join(', ')} (rôle au-dessus du mien)`);
  if (failed) lines.push(`⚠️ ${failed} autorisation(s) de salon impossible(s) à retirer (il me faut « Gérer les permissions »)`);
  if (admins.size) lines.push(`ℹ️ Les rôles Administrateur l’ont quand même : ${admins.map((r) => `${r}`).join(', ')}`);
  console.log(`[applications externes] ${removedRoles.length} rôle(s), ${removed} autorisation(s) de salon retirée(s)`);
  await report(guild, lines);
}

// Rôle créé ou modifié avec la permission : retirée aussitôt.
export async function guardExternalAppsRole(role) {
  if (!enforced(role.guild)) return;
  const result = await stripRole(role);
  if (!result) return;
  await report(role.guild, [
    result === 'removed'
      ? `✅ Retirée du rôle ${roleName(role.guild, role.id)} qui venait de la recevoir.`
      : `⚠️ Le rôle ${roleName(role.guild, role.id)} l’a reçue, mais il est au-dessus du mien : je ne peux pas la retirer.`,
  ]);
}

// Salon créé ou modifié avec l'autorisation pour un rôle (autre que Crown) ou un membre : retirée aussitôt.
export async function guardExternalAppsChannel(channel) {
  if (!enforced(channel.guild)) return;
  const { removed, failed } = await stripChannel(channel);
  if (!removed && !failed) return;
  await report(channel.guild, [
    removed ? `✅ Retirée dans les permissions de ${channel} (${removed} autorisation(s)).` : `⚠️ ${channel} l’autorise, mais je ne peux pas modifier ses permissions.`,
  ]);
}
