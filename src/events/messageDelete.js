import { Events, EmbedBuilder, AttachmentBuilder, AuditLogEvent } from 'discord.js';
import { sendLog, Colors, findExecutor } from '../lib/logger.js';
import { takeCachedAttachments } from '../lib/attachmentCache.js';

export default {
  name: Events.MessageDelete,
  async execute(message) {
    if (!message.guild) return;
    if (message.author?.bot) return;

    const embed = new EmbedBuilder()
      .setColor(Colors.delete)
      .setAuthor({ name: '🗑️ Message supprimé' })
      .setDescription(
        message.content
          ? message.content.slice(0, 2000)
          : '*(contenu indisponible — message non mis en cache)*',
      )
      .addFields(
        {
          name: 'Auteur',
          value: message.author ? `${message.author} (${message.author.tag})` : 'Inconnu',
          inline: true,
        },
        { name: 'Salon', value: `${message.channel}`, inline: true },
      )
      .setTimestamp();

    // Photos/vidéos mises en cache à la création → on les ré-attache pour les afficher.
    const cached = takeCachedAttachments(message.id);
    const files = cached.map((f) => new AttachmentBuilder(f.buffer, { name: f.name }));

    if (message.attachments?.size) {
      embed.addFields({
        name: 'Pièces jointes',
        value: message.attachments.map((a) => a.name || a.url).join('\n').slice(0, 1000),
      });
    }

    // Qui a supprimé (si c'est un modérateur et non l'auteur)
    const executor = await findExecutor(message.guild, AuditLogEvent.MessageDelete, message.author?.id);
    if (executor && executor.id !== message.author?.id) {
      embed.addFields({ name: 'Supprimé par', value: `${executor}`, inline: true });
    }

    await sendLog(message.guild, embed, files);
  },
};
