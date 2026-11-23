import { getGuildConfig, setGuildConfig, getRoleBoosts, setRoleBoosts } from './store.js';

// Réglages demandés en dehors du bot (sans passer par une commande), appliqués UNE fois au démarrage par le bot
// lui-même : écrire directement en base serait écrasé par la mémoire du bot en marche. Chaque réglage est marqué
// dans data[guildId].oneShots et ne revient jamais ; il reste ensuite modifiable avec les commandes habituelles.
const HANAMI = '1563159382361907350';
const ONE_SHOTS = [
  {
    // 2026-11-23 : rôle VIP recréé après le raid (nouvel identifiant), toujours ×1,3 en XP et en argent (ensuite :
    // /boostrole). L'ancien VIP (supprimé) est retiré des boosts.
    id: 'vip-boost-1.3-raid',
    guildId: HANAMI,
    run: (guildId) => {
      const boosts = { ...getRoleBoosts(guildId), '1573940838520852563': { xp: 1.3, money: 1.3 } };
      delete boosts['1563160561477353493'];
      setRoleBoosts(guildId, boosts);
    },
  },
];

export function applyOneShots(client) {
  for (const shot of ONE_SHOTS) {
    if (!client.guilds.cache.has(shot.guildId)) continue;
    const done = getGuildConfig(shot.guildId).oneShots ?? {};
    if (done[shot.id]) continue;
    shot.run(shot.guildId);
    setGuildConfig(shot.guildId, { oneShots: { ...getGuildConfig(shot.guildId).oneShots, [shot.id]: Date.now() } });
    console.log(`[réglage unique] ${shot.id} appliqué.`);
  }
}
