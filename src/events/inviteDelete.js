import { Events } from 'discord.js';
import { trackInviteDelete } from '../lib/invites.js';

export default {
  name: Events.InviteDelete,
  execute(invite) {
    trackInviteDelete(invite);
  },
};
