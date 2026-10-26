import { EmbedBuilder } from 'discord.js';
import { getLevelsEnabled, getXpEvent, setXpEvent } from './store.js';
import { grantXp, xpMultiplier } from './levels.js';
import { checkQuests } from './quests.js';

// XP en vocal : chaque minute, les membres en conversation gagnent de l'XP (multipliée par
// l'événement, le booster en cours et le rôle boosté). Comptés : pas en sourdine (casque coupé), pas dans le salon
// AFK, et au moins 2 personnes (hors bots) dans le salon. Les annonces (passage de niveau, quête)
// vont dans le chat du salon vocal.
export const VOICE_XP_PER_MINUTE = 5;

export async function grantVoiceXp(client) {
  for (const guild of client.guilds.cache.values()) {
    if (!getLevelsEnabled(guild.id)) continue;
    for (const channel of guild.channels.cache.values()) {
      if (!channel.isVoiceBased?.() || channel.id === guild.afkChannelId) continue;
      const humans = channel.members.filter((m) => !m.user.bot);
      if (humans.size < 2) continue;
      for (const member of humans.values()) {
        if (member.voice.deaf) continue; // casque coupé (par lui ou par un modo)
        const ctx = { guild, author: member.user, member, channel: channel.isTextBased?.() ? channel : null };
        const amount = Math.round(VOICE_XP_PER_MINUTE * xpMultiplier(guild.id, member.id, member));
        await grantXp(ctx, amount).catch((err) => console.error('[xp vocal]', err));
        await checkQuests(ctx).catch((err) => console.error('[quetes]', err));
      }
    }
  }
}

// Fin des événements XP (/xp evenement) : annoncée dans le salon où il a été lancé.
export async function endXpEvents(client) {
  const now = Date.now();
  for (const guild of client.guilds.cache.values()) {
    const event = getXpEvent(guild.id);
    if (!event || event.endsAt > now) continue;
    setXpEvent(guild.id, null);
    const channel = guild.channels.cache.get(event.channelId);
    await channel
      ?.send({
        embeds: [new EmbedBuilder().setColor(0x4e5058).setTitle(`⏰ Fin de l’événement XP ×${event.multiplier}`).setDescription('L’XP revient à la normale. Merci à tous d’avoir participé !')],
      })
      .catch(() => {});
  }
}
