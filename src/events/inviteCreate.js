import { Events } from 'discord.js';
import { trackInviteCreate } from '../lib/invites.js';

export default {
  name: Events.InviteCreate,
  execute(invite) {
    trackInviteCreate(invite);
  },
};
