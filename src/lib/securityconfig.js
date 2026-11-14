import { getGuildConfig, setGuildConfig } from './store.js';

// Réglages des protections de /config securite : data[guildId].security = { mention, invite, everyone, vanity,
// update, ban, deco, bot }. Les protections plus anciennes gardent leurs propres réglages : anti-spam
// (data.antispam), anti-liens (/config lien) et anti-nuke (data.antinuke).
export const SECURITY_DEFAULTS = {
  mention: { enabled: false, users: 5, roles: 3, muteMin: 10 },
  invite: { enabled: false },
  everyone: { enabled: false },
  vanity: { enabled: false, code: null },
  update: { enabled: false, snapshot: null },
  ban: { enabled: true, max: 4, seconds: 60 },
  deco: { enabled: false, max: 5, seconds: 60 },
  bot: { enabled: true },
};

export function getSecurity(guildId, key) {
  return { ...SECURITY_DEFAULTS[key], ...(getGuildConfig(guildId).security?.[key] ?? {}) };
}

export function setSecurity(guildId, key, patch) {
  const all = getGuildConfig(guildId).security ?? {};
  setGuildConfig(guildId, { security: { ...all, [key]: { ...getSecurity(guildId, key), ...patch } } });
}
