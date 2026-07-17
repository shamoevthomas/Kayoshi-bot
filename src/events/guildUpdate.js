import { Events, EmbedBuilder, AuditLogEvent } from 'discord.js';
import { sendLog, Colors, findExecutor } from '../lib/logger.js';

export default {
  name: Events.GuildUpdate,
  async execute(oldGuild, newGuild) {
    const changes = [];
    if (oldGuild.name !== newGuild.name) changes.push(`**Nom** : ${oldGuild.name} → ${newGuild.name}`);
    if (oldGuild.iconURL() !== newGuild.iconURL()) changes.push('**Icône** modifiée');
    if (oldGuild.bannerURL() !== newGuild.bannerURL()) changes.push('**Bannière** modifiée');
    if (oldGuild.ownerId !== newGuild.ownerId)
      changes.push(`**Propriétaire** : <@${oldGuild.ownerId}> → <@${newGuild.ownerId}>`);
    if (oldGuild.afkChannelId !== newGuild.afkChannelId) changes.push('**Salon AFK** modifié');
    if (oldGuild.systemChannelId !== newGuild.systemChannelId) changes.push('**Salon système** modifié');
    if (oldGuild.verificationLevel !== newGuild.verificationLevel)
      changes.push(`**Niveau de vérification** : ${oldGuild.verificationLevel} → ${newGuild.verificationLevel}`);
    if (oldGuild.premiumTier !== newGuild.premiumTier)
      changes.push(`**Niveau de boost** : ${oldGuild.premiumTier} → ${newGuild.premiumTier}`);
    if (changes.length === 0) return;

    const executor = await findExecutor(newGuild, AuditLogEvent.GuildUpdate, newGuild.id);

    const embed = new EmbedBuilder()
      .setColor(Colors.server)
      .setAuthor({ name: '⚙️ Paramètres du serveur modifiés' })
      .setDescription(changes.join('\n'))
      .setTimestamp();

    if (executor) embed.addFields({ name: 'Par', value: `${executor}`, inline: true });
    await sendLog(newGuild, embed);
  },
};
