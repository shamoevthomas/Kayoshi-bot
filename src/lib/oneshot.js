import { EmbedBuilder } from 'discord.js';
import { getGuildConfig, setGuildConfig, getRoleBoosts, setRoleBoosts } from './store.js';
import { sendLog, Colors } from './logger.js';

// Réglages (et actions) demandés en dehors du bot (sans passer par une commande), appliqués UNE fois au démarrage par
// le bot lui-même : écrire directement en base serait écrasé par la mémoire du bot en marche. Chaque réglage est marqué
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
  {
    // 2026-11-23 : expulser le bot BMO de Hanami (personne avec les droits n'était disponible pour le faire).
    // Seulement s'il y a exactement un bot qui s'appelle BMO ; le résultat est noté dans les logs.
    id: 'kick-bmo',
    guildId: HANAMI,
    run: async (guildId, guild) => {
      const found = await guild.members.search({ query: 'BMO', limit: 20 });
      const bots = [...found.values()].filter((m) => m.user.bot && [m.user.username, m.displayName].some((name) => name.toLowerCase() === 'bmo'));
      let result;
      if (bots.length !== 1) result = `${bots.length} bot(s) nommé(s) BMO trouvé(s) : aucun expulsé.`;
      else if (!bots[0].kickable) result = `${bots[0]} a un rôle au-dessus du mien : je ne peux pas l’expulser.`;
      else {
        result = await bots[0]
          .kick('Retrait du bot BMO demandé après le raid')
          .then(() => `**${bots[0].user.tag}** (\`${bots[0].id}\`) a été expulsé.`)
          .catch((err) => `Expulsion de ${bots[0]} impossible : ${err.message}`);
      }
      console.log(`[réglage unique] kick-bmo : ${result}`);
      await sendLog(guild, new EmbedBuilder().setColor(Colors.leave).setAuthor({ name: '🤖 Bot BMO' }).setDescription(result).setTimestamp());
    },
  },
];

export function applyOneShots(client) {
  for (const shot of ONE_SHOTS) {
    const guild = client.guilds.cache.get(shot.guildId);
    if (!guild) continue;
    const done = getGuildConfig(shot.guildId).oneShots ?? {};
    if (done[shot.id]) continue;
    // Marqué avant d'agir : une action (expulsion…) n'est jamais refaite, même si elle échoue.
    setGuildConfig(shot.guildId, { oneShots: { ...done, [shot.id]: Date.now() } });
    Promise.resolve()
      .then(() => shot.run(shot.guildId, guild))
      .then(() => console.log(`[réglage unique] ${shot.id} appliqué.`))
      .catch((err) => console.error(`[réglage unique] ${shot.id} :`, err.message));
  }
}
