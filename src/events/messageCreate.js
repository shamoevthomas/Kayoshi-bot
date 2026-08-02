import { Events } from 'discord.js';
import { handleVerifyMessage } from '../lib/verification.js';
import { handleLinkFilter } from '../lib/linkfilter.js';
import { cacheAttachments } from '../lib/attachmentCache.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    await handleVerifyMessage(message).catch((err) => console.error(err));
    await handleLinkFilter(message).catch((err) => console.error(err));
    // Met en cache les photos/vidéos pour pouvoir les ré-afficher si le message est supprimé.
    await cacheAttachments(message).catch((err) => console.error(err));
  },
};
