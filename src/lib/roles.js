import { EmbedBuilder } from 'discord.js';
import { getDueTempRoles, removeTempRole } from './store.js';
import { sendLog, Colors } from './logger.js';

// Rôle verrouillé par /lock et /unlock (celui des membres) : « Membre » sur Hanami, celui de l'ancien
// serveur Ichima ; @everyone sur un serveur qui n'a aucun des deux.
const LOCK_ROLE_IDS = ['1563160648345591818', '1272125126149673051'];
export const lockRole = (guild) => LOCK_ROLE_IDS.map((id) => guild.roles.cache.get(id)).find(Boolean) ?? guild.roles.everyone;

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
  // …et sous celui de l'auteur (sauf propriétaire), pour qu'un modo n'aille pas plus haut que lui.
  if (interaction.user.id !== guild.ownerId && role.position >= interaction.member.roles.highest.position) {
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
