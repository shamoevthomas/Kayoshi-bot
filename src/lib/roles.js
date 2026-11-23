import { EmbedBuilder } from 'discord.js';
import { getDueTempRoles, removeTempRole } from './store.js';
import { sendLog, Colors } from './logger.js';
import { isOwnerLike } from './coowners.js';

// Rôle verrouillé par +lock et +unlock : celui des membres de l'ancien serveur Ichima ; @everyone partout ailleurs
// (Hanami compris : sans vérification, les nouveaux venus n'ont pas forcément le rôle Membre).
const LOCK_ROLE_IDS = ['1272125126149673051'];
export const lockRole = (guild) => LOCK_ROLE_IDS.map((id) => guild.roles.cache.get(id)).find(Boolean) ?? guild.roles.everyone;

// Gèrent des rôles au niveau du leur et au-dessus (toujours sous celui du bot) : le propriétaire et ses
// co-propriétaires (50.nn et l0un4tik sur les serveurs de laysox_off, lib/coowners.js).
export const isHierarchyExempt = (guild, userId) => isOwnerLike(guild, userId);

// Raison pour laquelle l'auteur de la commande ne peut pas donner / retirer ce rôle via le bot
// (/role, /roletempo…), ou null.
export function roleCommandProblem(interaction, role, verb = 'gérer') {
  const { guild } = interaction;
  if (role.id === guild.id) return `❌ Impossible de ${verb} le rôle @everyone.`;
  if (role.managed) return `❌ Le rôle ${role} est géré par une intégration, impossible de le ${verb} manuellement.`;
  // Le rôle doit être sous le rôle le plus haut du bot…
  if (role.position >= guild.members.me.roles.highest.position) {
    return `❌ Le rôle ${role} est au-dessus de mon rôle le plus haut, je ne peux pas le ${verb}.`;
  }
  // …et sous celui de l'auteur (sauf propriétaire et exemptés), pour qu'un modo n'aille pas plus haut que lui.
  if (!isHierarchyExempt(guild, interaction.user.id) && role.position >= interaction.member.roles.highest.position) {
    return `❌ Le rôle ${role} est au-dessus (ou au niveau) de ton rôle le plus haut.`;
  }
  return null;
}

// Retire les rôles temporaires arrivés à échéance (appelée toutes les 30 s).
export async function processTempRoles(client) {
  for (const { guildId, userId, roleId, by } of getDueTempRoles()) {
    // Retiré de la liste d'abord : pas de nouvel essai en boucle si le retrait échoue.
    removeTempRole(guildId, userId, roleId);
    const guild = client.guilds.cache.get(guildId);
    const role = guild?.roles.cache.get(roleId);
    const member = guild && (await guild.members.fetch(userId).catch(() => null));
    if (!role || !member?.roles.cache.has(roleId)) continue;
    const removed = await member.roles
      .remove(role, 'Fin du rôle temporaire (/roletempo)')
      .then(() => true)
      .catch(() => false);
    await sendLog(
      guild,
      new EmbedBuilder()
        .setColor(removed ? Colors.role : Colors.delete)
        .setAuthor({ name: removed ? '⏱️ Rôle temporaire terminé' : '⚠️ Rôle temporaire : retrait impossible' })
        .setDescription(`${role} ${removed ? 'retiré à' : 'n’a pas pu être retiré à'} ${member}`)
        .addFields({ name: 'Donné par', value: by ? `<@${by}>` : 'Inconnu', inline: true })
        .setTimestamp(),
    );
  }
}
