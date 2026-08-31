import { EmbedBuilder } from 'discord.js';
import { Colors } from './logger.js';

// Envoie un MP (embed) à la personne sanctionnée.
// actionLabel : « averti », « rendu muet », « expulsé », « banni »…
// Renvoie true si le MP est bien passé, false sinon (MP fermés).
export async function dmSanction(user, guild, actionLabel, reason, moderator, showModerator) {
  const embed = new EmbedBuilder()
    .setColor(Colors.delete)
    .setTitle(`Vous avez été ${actionLabel} sur ${guild.name}`)
    .addFields({ name: 'Raison', value: reason || 'Aucune raison précisée' })
    .setTimestamp();
  if (guild.iconURL()) embed.setThumbnail(guild.iconURL());
  if (showModerator && moderator) {
    embed.addFields({ name: 'Modérateur', value: moderator.username });
  }
  return user
    .send({ embeds: [embed] })
    .then(() => true)
    .catch(() => false);
}

// Petit suffixe à ajouter à la réponse du modérateur pour indiquer l'état du MP.
export function dmNote(sent) {
  return sent ? '\n📩 Membre prévenu en MP.' : '\n⚠️ MP non envoyé (messages privés fermés).';
}
