import { Events, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../lib/logger.js';

export default {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    if (!newMessage.guild) return;
    if (newMessage.author?.bot) return;

    // Récupère l'ancien contenu (peut être partiel/non mis en cache)
    if (oldMessage.partial) oldMessage = await oldMessage.fetch().catch(() => oldMessage);
    if (newMessage.partial) newMessage = await newMessage.fetch().catch(() => newMessage);

    const before = oldMessage.content ?? '';
    const after = newMessage.content ?? '';

    // Ignore les "faux" updates (embed déployé, épinglage…) où le texte n'a pas changé
    if (before === after) return;

    const embed = new EmbedBuilder()
      .setColor(Colors.edit)
      .setAuthor({ name: '✏️ Message modifié' })
      .addFields(
        {
          name: 'Avant',
          value: before ? before.slice(0, 1024) : '*(indisponible — message non mis en cache)*',
        },
        {
          name: 'Après',
          value: after ? after.slice(0, 1024) : '*(vide)*',
        },
        {
          name: 'Auteur',
          value: newMessage.author ? `${newMessage.author} (${newMessage.author.tag})` : 'Inconnu',
          inline: true,
        },
        { name: 'Salon', value: `${newMessage.channel}`, inline: true },
      )
      .setTimestamp();

    if (newMessage.url) {
      embed.addFields({ name: 'Lien', value: `[Aller au message](${newMessage.url})`, inline: true });
    }

    await sendLog(newMessage.guild, embed);
  },
};
