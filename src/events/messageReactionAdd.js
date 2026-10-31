import { Events } from 'discord.js';
import { handleQuoteReaction } from '../lib/quotebook.js';

// Réaction ajoutée : 📖 ajoute le message au livre des citations (lib/quotebook.js).
export default {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    await handleQuoteReaction(reaction, user).catch((err) => console.error('[citations]', err));
  },
};
