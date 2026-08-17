import { PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getServerBlacklist, setQuarantineRole, isWhitelisted } from './store.js';
import { sendLog, Colors } from './logger.js';

// Crée (si besoin) le rôle de quarantaine et lui refuse "Voir les salons"
// partout. Renvoie le rôle, ou null si impossible.
export async function ensureQuarantineRole(guild) {
  const config = getServerBlacklist(guild.id);
  let role = config.quarantineRoleId
    ? guild.roles.cache.get(config.quarantineRoleId) ?? (await guild.roles.fetch(config.quarantineRoleId).catch(() => null))
    : null;

  if (!role) {
    role = await guild.roles
      .create({
        name: '🚫 Blacklist',
        color: 0x2b2d31,
        permissions: [],
        reason: 'Rôle de quarantaine (blacklist de serveurs)',
      })
      .catch(() => null);
    if (!role) return null;
    setQuarantineRole(guild.id, role.id);
  }

  // Refuse "Voir les salons" sur tous les salons de premier niveau + catégories.
  for (const [, channel] of guild.channels.cache) {
    if (channel.permissionOverwrites?.edit) {
      await channel.permissionOverwrites
        .edit(role.id, { ViewChannel: false, Connect: false })
        .catch(() => {});
    }
  }
  return role;
}

// Applique le blocage au rôle de quarantaine sur un nouveau salon (channelCreate).
export async function applyQuarantineToChannel(channel) {
  if (!channel.guild || !channel.permissionOverwrites?.edit) return;
  const { quarantineRoleId } = getServerBlacklist(channel.guild.id);
  if (!quarantineRoleId) return;
  await channel.permissionOverwrites.edit(quarantineRoleId, { ViewChannel: false, Connect: false }).catch(() => {});
}

// Renvoie l'ID du premier serveur blacklisté (partagé avec le bot) où se
// trouve l'utilisateur, ou null.
async function findBlacklistedServerFor(client, serverIds, userId) {
  for (const sid of serverIds) {
    const g = client.guilds.cache.get(sid);
    if (!g) continue; // le bot n'est pas dans ce serveur → impossible de vérifier
    const m = await g.members.fetch(userId).catch(() => null);
    if (m) return g;
  }
  return null;
}

// À l'arrivée d'un membre : s'il est dans un serveur blacklisté (et pas
// whitelisté), on lui met le rôle de quarantaine.
export async function handleBlacklistJoin(member) {
  const config = getServerBlacklist(member.guild.id);
  if (!config.serverIds.length) return;
  if (isWhitelisted(member.guild.id, member.id)) return;

  const from = await findBlacklistedServerFor(member.client, config.serverIds, member.id);
  if (!from) return;

  const role = await ensureQuarantineRole(member.guild);
  if (!role) return;
  await member.roles.add(role, `Membre d'un serveur blacklisté : ${from.name}`).catch(() => {});

  await sendLog(
    member.guild,
    new EmbedBuilder()
      .setColor(Colors.delete)
      .setAuthor({ name: '🚫 Membre mis en quarantaine' })
      .setDescription(`${member} (${member.user.tag}) est membre d’un **serveur blacklisté**.`)
      .addFields(
        { name: 'Serveur détecté', value: `${from.name} (\`${from.id}\`)`, inline: false },
        { name: 'Débloquer', value: `\`/whitelist ajouter membre:@${member.user.username}\``, inline: false },
      )
      .setTimestamp(),
  );
}

// Retire la quarantaine d'un membre (utilisé par /whitelist).
export async function liftQuarantine(guild, userId) {
  const { quarantineRoleId } = getServerBlacklist(guild.id);
  if (!quarantineRoleId) return false;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member || !member.roles.cache.has(quarantineRoleId)) return false;
  await member.roles.remove(quarantineRoleId, 'Ajouté à la whitelist').catch(() => {});
  return true;
}

// Vérifie que le bot peut gérer les rôles (pour la quarantaine).
export function botCanManageRoles(guild) {
  return guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles) ?? false;
}
