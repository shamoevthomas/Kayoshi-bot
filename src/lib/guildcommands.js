import { createHash } from 'node:crypto';
import { ApplicationIntegrationType, Routes } from 'discord.js';
import { getGuildConfig, setGuildConfig } from './store.js';

// « +cmd on » (laysox_off, 50.nn et l0un4tik seulement, sur n'importe quel serveur du bot) : installe toutes les
// commandes slash du bot sur CE serveur seulement (commandes de serveur : rien n'est ajouté ailleurs). « +cmd off » les
// retire, « +cmd » dit où on en est. Indépendant de la liste de « @Kayoshi cmd @membre ».
// Les serveurs où c'est activé (data[guildId].slashCommands) sont remis à jour au démarrage du bot quand les commandes
// ont changé (empreinte), et quand le bot y est rajouté. Le ou les serveurs de GUILD_ID (Hanami) les reçoivent déjà
// avec « npm run deploy » : « +cmd » n'y change rien.
// Hanami est toujours compté, même si GUILD_ID manque sur l'hébergeur : « +cmd off » ne doit jamais y retirer les commandes.
const mainGuilds = () => ['1563159382361907350', ...(process.env.GUILD_ID ?? '').split(',').map((id) => id.trim()).filter(Boolean)];
const ALLOWED = ['1079335251551191061', '1543615549974515763', '1260266494839754866']; // laysox_off, 50.nn, l0un4tik
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Mêmes commandes que « npm run deploy » met sur Hanami (celles de l'application externe, comme /say, sont globales).
function commandsBody(client) {
  return [...client.commands.values()]
    .map((c) => c.data.toJSON())
    .filter((c) => !c.integration_types?.includes(ApplicationIntegrationType.UserInstall));
}
const fingerprint = (body) => createHash('sha1').update(JSON.stringify(body)).digest('hex');
const put = (guild, body) => guild.client.rest.put(Routes.applicationGuildCommands(guild.client.user.id, guild.id), { body });

async function install(guild, by) {
  const body = commandsBody(guild.client);
  await put(guild, body);
  setGuildConfig(guild.id, { slashCommands: { on: true, hash: fingerprint(body), by, at: Date.now() } });
  return body.length;
}

export async function handleGuildCommandsCommand(message) {
  if (!message.guild || message.author.bot) return false;
  const match = message.content.trim().match(/^\+cmd(?:\s+(\S+))?$/i);
  if (!match) return false;
  const { guild } = message;
  const reply = (content) => message.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
  if (!ALLOWED.includes(message.author.id)) return true; // les autres sont ignorés
  if (mainGuilds().includes(guild.id)) {
    await reply('ℹ️ Toutes les commandes sont déjà sur ce serveur : elles sont mises à jour à chaque déploiement du bot.');
    return true;
  }
  const arg = (match[1] ?? '').toLowerCase();
  const on = getGuildConfig(guild.id).slashCommands?.on === true;
  try {
    if (arg === 'on') {
      const count = await install(guild, message.author.id);
      await reply(
        `✅ **${count}** commandes slash installées sur **ce serveur seulement**. Tape \`/\` pour les voir (si elles n’apparaissent pas, relance Discord avec Ctrl+R).\n` +
          '-# Elles se mettent à jour toutes seules quand le bot change. Pour les retirer : `+cmd off`. Le système de niveaux reste désactivé tant que tu ne l’actives pas (`/config` → Niveaux).',
      );
    } else if (arg === 'off') {
      await put(guild, []);
      setGuildConfig(guild.id, { slashCommands: { on: false, by: message.author.id, at: Date.now() } });
      await reply('✅ Commandes slash retirées de ce serveur. Pour les remettre : `+cmd on`.');
    } else {
      await reply(`ℹ️ Commandes slash sur ce serveur : **${on ? 'activées' : 'désactivées'}**. \`+cmd on\` pour toutes les installer ici, \`+cmd off\` pour les retirer.`);
    }
  } catch (err) {
    console.error('[+cmd]', guild.id, err.message);
    await reply(
      err.code === 50001
        ? '❌ Discord refuse que j’ajoute des commandes ici : réinvite-moi avec l’autorisation « applications.commands » (lien d’invitation du bot), puis refais `+cmd on`.'
        : `❌ Impossible de modifier les commandes de ce serveur : ${err.message}`,
    );
  }
  return true;
}

// Au démarrage : serveurs avec « +cmd on » dont les commandes ont changé depuis.
export async function syncGuildCommands(client) {
  const hash = fingerprint(commandsBody(client));
  for (const guild of client.guilds.cache.values()) {
    const state = getGuildConfig(guild.id).slashCommands;
    if (!state?.on || state.hash === hash || mainGuilds().includes(guild.id)) continue;
    await install(guild, state.by).catch((err) => console.error('[+cmd] mise à jour', guild.id, err.message));
    await sleep(1000);
  }
}

// Bot rajouté sur un serveur qui avait fait « +cmd on » : Discord a retiré ses commandes, on les remet.
export async function reinstallOnJoin(guild) {
  const state = getGuildConfig(guild.id).slashCommands;
  if (state?.on && !mainGuilds().includes(guild.id)) await install(guild, state.by);
}
