import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getTeams, setTeam, getMoney, addMoney } from './store.js';
import { parseAmount } from './economy.js';
import { formatMoney } from './shop.js';

// Teams (/team) : un chef, jusqu'à 10 membres, un coffre commun, des soldats et des cadenas.
// Une team attaque une autre avec ses soldats pour piller son coffre ; chaque cadenas bloque une attaque.
// Invitations : boutons team_inv:<team>:<membre>:<date>:<yes|no> (valables 24 h, marchent après un redémarrage).
export const TEAM_PRICE = 500;
export const SOLDIER_PRICE = 50;
export const LOCK_PRICE = 250;
const MAX_MEMBERS = 10;
const MAX_LOCKS = 5;
const HOUR = 3_600_000;
const ATTACK_COOLDOWN = 2 * HOUR;
const SAFE_AFTER_ATTACK = HOUR; // une team attaquée ne peut pas l'être à nouveau pendant 1 h
const MIN_LOOT_VAULT = 100;
const INVITE_MS = 24 * HOUR;

const rand = (min, max) => min + Math.random() * (max - min);
const ts = (ms) => `<t:${Math.floor(ms / 1000)}:R>`;
const ephemeral = (interaction, content) => interaction.reply({ content, ephemeral: true });

export function teamOf(guildId, userId) {
  const entry = Object.entries(getTeams(guildId)).find(([, t]) => t.members.includes(userId));
  return entry ? { id: entry[0], ...entry[1] } : null;
}

function findTeam(guildId, query) {
  const q = String(query ?? '').trim().toLowerCase();
  const entry = Object.entries(getTeams(guildId)).find(([id, t]) => id === query || t.name.toLowerCase() === q);
  return entry ? { id: entry[0], ...entry[1] } : null;
}

const save = (guildId, { id, ...team }) => setTeam(guildId, id, team);

// Autocomplétion des noms de team (/team info, /team attaquer).
export function teamChoices(guildId, query) {
  const q = String(query ?? '').toLowerCase();
  return Object.entries(getTeams(guildId))
    .filter(([, t]) => t.name.toLowerCase().includes(q))
    .sort((a, b) => b[1].vault - a[1].vault)
    .slice(0, 25)
    .map(([id, t]) => ({ name: `${t.name} — 💰 ${formatMoney(t.vault)} · 🪖 ${t.soldiers}`.slice(0, 100), value: id }));
}

// Classement des teams (/top teams), par coffre.
export function teamLeaderboard(guildId) {
  return Object.values(getTeams(guildId))
    .sort((a, b) => b.vault - a.vault)
    .map((t) => ({ name: t.name, members: t.members, text: `💰 **${formatMoney(t.vault)}** · 🪖 ${t.soldiers} · 🔒 ${t.locks} · ${t.members.length} membre(s)` }));
}

async function create(interaction) {
  const { guild, user } = interaction;
  if (teamOf(guild.id, user.id)) return ephemeral(interaction, '❌ Tu es déjà dans une team (`/team quitter` d’abord).');
  const name = interaction.options.getString('nom', true).replace(/[`*_~|@#<>\\\n]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length < 2 || name.length > 24) return ephemeral(interaction, '❌ Le nom doit faire entre 2 et 24 caractères (sans mise en forme).');
  if (findTeam(guild.id, name)) return ephemeral(interaction, `❌ Une team s’appelle déjà **${name}**.`);
  const pocket = getMoney(guild.id, user.id);
  if (pocket < TEAM_PRICE) return ephemeral(interaction, `❌ Créer une team coûte 💰 **${TEAM_PRICE}** (en poche), tu as **${formatMoney(pocket)}**.`);
  addMoney(guild.id, user.id, -TEAM_PRICE);
  let id;
  do id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  while (getTeams(guild.id)[id]);
  setTeam(guild.id, id, { name, ownerId: user.id, members: [user.id], vault: 0, soldiers: 0, locks: 0, wins: 0, losses: 0, createdAt: Date.now() });
  return interaction.reply({
    content:
      `👥 ${user} fonde la team **${name}** (💰 ${TEAM_PRICE}) !\n` +
      '-# `/team inviter` pour recruter, `/team deposer` pour remplir le coffre, `/team acheter` pour les soldats et les cadenas.',
    allowedMentions: { parse: [] },
  });
}

async function invite(interaction) {
  const { guild, user } = interaction;
  const team = teamOf(guild.id, user.id);
  if (!team) return ephemeral(interaction, '❌ Tu n’as pas de team (`/team creer`).');
  if (team.ownerId !== user.id) return ephemeral(interaction, '❌ Seul le chef de la team peut inviter.');
  const target = interaction.options.getMember('membre');
  if (!target || target.user.bot) return ephemeral(interaction, '❌ Choisis un membre du serveur (pas un bot).');
  if (teamOf(guild.id, target.id)) return ephemeral(interaction, `❌ ${target} est déjà dans une team.`);
  if (team.members.length >= MAX_MEMBERS) return ephemeral(interaction, `❌ Ta team est complète (${MAX_MEMBERS} membres).`);
  const base = `team_inv:${team.id}:${target.id}:${Date.now()}`;
  return interaction.reply({
    content: `📨 ${target}, ${user} t’invite dans la team **${team.name}** ! (valable 24 h)`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${base}:yes`).setLabel('Rejoindre').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${base}:no`).setLabel('Refuser').setEmoji('✖️').setStyle(ButtonStyle.Secondary),
      ),
    ],
    allowedMentions: { users: [target.id] },
  });
}

export async function handleTeamInteraction(interaction) {
  const [, teamId, userId, at, answer] = interaction.customId.split(':');
  const { guild, user } = interaction;
  if (user.id !== userId) return ephemeral(interaction, '❌ Cette invitation n’est pas pour toi.');
  const team = findTeam(guild.id, teamId);
  const done = (content) => interaction.update({ content, components: [], allowedMentions: { parse: [] } });
  if (!team) return done('❌ Cette team n’existe plus.');
  if (Date.now() - Number(at) > INVITE_MS) return done(`⌛ L’invitation dans **${team.name}** a expiré.`);
  if (answer === 'no') return done(`✖️ ${user} a refusé de rejoindre **${team.name}**.`);
  if (teamOf(guild.id, user.id)) return ephemeral(interaction, '❌ Tu es déjà dans une team (`/team quitter` d’abord).');
  if (team.members.length >= MAX_MEMBERS) return done(`❌ La team **${team.name}** est complète.`);
  team.members.push(user.id);
  save(guild.id, team);
  return done(`✅ ${user} rejoint la team **${team.name}** ! (${team.members.length}/${MAX_MEMBERS})`);
}

async function leave(interaction) {
  const { guild, user } = interaction;
  const team = teamOf(guild.id, user.id);
  if (!team) return ephemeral(interaction, '❌ Tu n’es dans aucune team.');
  team.members = team.members.filter((id) => id !== user.id);
  if (!team.members.length) {
    // Dernier membre : la team disparaît et il récupère le coffre.
    setTeam(guild.id, team.id, null);
    addMoney(guild.id, user.id, team.vault);
    return interaction.reply({
      content: `👋 ${user} quitte **${team.name}**, qui disparaît.${team.vault ? ` Il récupère le coffre : 💰 **${formatMoney(team.vault)}**.` : ''}`,
      allowedMentions: { parse: [] },
    });
  }
  let note = '';
  if (team.ownerId === user.id) {
    team.ownerId = team.members[0];
    note = ` <@${team.ownerId}> devient le chef.`;
  }
  save(guild.id, team);
  return interaction.reply({ content: `👋 ${user} quitte la team **${team.name}**.${note}`, allowedMentions: { users: [team.ownerId] } });
}

async function kick(interaction) {
  const { guild, user } = interaction;
  const team = teamOf(guild.id, user.id);
  if (!team || team.ownerId !== user.id) return ephemeral(interaction, '❌ Seul le chef d’une team peut en expulser un membre.');
  const target = interaction.options.getUser('membre', true);
  if (target.id === user.id) return ephemeral(interaction, '❌ Pour partir, utilise `/team quitter`.');
  if (!team.members.includes(target.id)) return ephemeral(interaction, `❌ ${target} n’est pas dans ta team.`);
  team.members = team.members.filter((id) => id !== target.id);
  save(guild.id, team);
  return interaction.reply({ content: `🚪 ${target} est expulsé de la team **${team.name}**.`, allowedMentions: { users: [target.id] } });
}

// Dissoudre : le coffre est partagé entre les membres (le reste de la division va au chef).
async function disband(interaction) {
  const { guild, user } = interaction;
  const team = teamOf(guild.id, user.id);
  if (!team || team.ownerId !== user.id) return ephemeral(interaction, '❌ Seul le chef d’une team peut la dissoudre.');
  const share = Math.floor(team.vault / team.members.length);
  for (const id of team.members) addMoney(guild.id, id, share);
  addMoney(guild.id, user.id, team.vault - share * team.members.length);
  setTeam(guild.id, team.id, null);
  return interaction.reply({
    content: `💥 La team **${team.name}** est dissoute.${team.vault ? ` Le coffre est partagé : 💰 **${formatMoney(share)}** pour chacun des ${team.members.length} membre(s).` : ''}`,
    allowedMentions: { parse: [] },
  });
}

async function info(interaction) {
  const { guild, user } = interaction;
  const query = interaction.options.getString('team');
  const team = query ? findTeam(guild.id, query) : teamOf(guild.id, user.id);
  if (!team) return ephemeral(interaction, query ? '❌ Team introuvable.' : '❌ Tu n’es dans aucune team : `/team creer`, ou `/team info` avec le nom d’une team.');
  const now = Date.now();
  const attackReady = !team.lastAttack || now - team.lastAttack >= ATTACK_COOLDOWN ? 'prête ✅' : ts(team.lastAttack + ATTACK_COOLDOWN);
  const embed = new EmbedBuilder()
    .setColor(0x9b59b6)
    .setTitle(`👥 ${team.name}`)
    .setDescription(
      [
        `👑 **Chef :** <@${team.ownerId}>`,
        `🧑‍🤝‍🧑 **Membres (${team.members.length}/${MAX_MEMBERS}) :** ${team.members.map((id) => `<@${id}>`).join(' ')}`,
        '',
        `💰 **Coffre :** ${formatMoney(team.vault)}`,
        `🪖 **Soldats :** ${team.soldiers} · 🔒 **Cadenas :** ${team.locks}/${MAX_LOCKS}`,
        `⚔️ **Combats :** ${team.wins} victoire(s), ${team.losses} défaite(s)`,
        `⏳ **Prochaine attaque :** ${attackReady}`,
      ].join('\n'),
    )
    .setFooter({ text: `Soldat : ${SOLDIER_PRICE} · cadenas : ${LOCK_PRICE} (payés avec le coffre)` });
  return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function deposit(interaction) {
  const { guild, user } = interaction;
  const team = teamOf(guild.id, user.id);
  if (!team) return ephemeral(interaction, '❌ Tu n’es dans aucune team.');
  const pocket = getMoney(guild.id, user.id);
  const amount = parseAmount(interaction.options.getString('montant') ?? 'tout', pocket);
  if (!amount || amount <= 0) return ephemeral(interaction, pocket ? '❌ Montant invalide (ex : `500`, `2k`, `moitié` ou `tout`).' : '❌ Tu n’as rien en poche.');
  if (amount > pocket) return ephemeral(interaction, `❌ Tu n’as que 💰 **${formatMoney(pocket)}** en poche.`);
  addMoney(guild.id, user.id, -amount);
  team.vault += amount;
  save(guild.id, team);
  return interaction.reply({ content: `💰 ${user} met 💰 **${formatMoney(amount)}** dans le coffre de **${team.name}** (coffre : 💰 ${formatMoney(team.vault)}).`, allowedMentions: { parse: [] } });
}

async function withdraw(interaction) {
  const { guild, user } = interaction;
  const team = teamOf(guild.id, user.id);
  if (!team || team.ownerId !== user.id) return ephemeral(interaction, '❌ Seul le chef d’une team peut retirer de l’argent du coffre.');
  const amount = parseAmount(interaction.options.getString('montant') ?? 'tout', team.vault);
  if (!amount || amount <= 0) return ephemeral(interaction, team.vault ? '❌ Montant invalide.' : '❌ Le coffre est vide.');
  if (amount > team.vault) return ephemeral(interaction, `❌ Le coffre ne contient que 💰 **${formatMoney(team.vault)}**.`);
  team.vault -= amount;
  save(guild.id, team);
  addMoney(guild.id, user.id, amount);
  return interaction.reply({ content: `👛 ${user} retire 💰 **${formatMoney(amount)}** du coffre de **${team.name}** (coffre : 💰 ${formatMoney(team.vault)}).`, allowedMentions: { parse: [] } });
}

async function buy(interaction) {
  const { guild, user } = interaction;
  const team = teamOf(guild.id, user.id);
  if (!team) return ephemeral(interaction, '❌ Tu n’es dans aucune team.');
  const item = interaction.options.getString('objet', true);
  let qty = interaction.options.getInteger('quantite') ?? 1;
  if (item === 'cadenas') {
    if (team.locks >= MAX_LOCKS) return ephemeral(interaction, `🔒 Ta team a déjà le maximum de cadenas (${MAX_LOCKS}).`);
    qty = Math.min(qty, MAX_LOCKS - team.locks);
  }
  const cost = qty * (item === 'cadenas' ? LOCK_PRICE : SOLDIER_PRICE);
  if (cost > team.vault) return ephemeral(interaction, `❌ Il faut 💰 **${formatMoney(cost)}** dans le coffre, il y a **${formatMoney(team.vault)}** (\`/team deposer\`).`);
  team.vault -= cost;
  if (item === 'cadenas') team.locks += qty;
  else team.soldiers += qty;
  save(guild.id, team);
  const what = item === 'cadenas' ? `🔒 **${qty}** cadenas (${team.locks}/${MAX_LOCKS})` : `🪖 **${qty}** soldat(s) (${team.soldiers} au total)`;
  return interaction.reply({ content: `🛒 ${user} achète ${what} pour **${team.name}** : 💰 ${formatMoney(cost)} pris dans le coffre.`, allowedMentions: { parse: [] } });
}

async function attack(interaction) {
  const { guild, user } = interaction;
  const mine = teamOf(guild.id, user.id);
  if (!mine) return ephemeral(interaction, '❌ Tu n’es dans aucune team.');
  const target = findTeam(guild.id, interaction.options.getString('team', true));
  if (!target) return ephemeral(interaction, '❌ Team introuvable.');
  if (target.id === mine.id) return ephemeral(interaction, '❌ Tu ne peux pas attaquer ta propre team.');
  if (mine.soldiers < 1) return ephemeral(interaction, `❌ Ta team n’a pas de soldats : \`/team acheter\` (🪖 ${SOLDIER_PRICE} chacun).`);
  const now = Date.now();
  if (mine.lastAttack && now - mine.lastAttack < ATTACK_COOLDOWN) return ephemeral(interaction, `⏳ Ta team a déjà attaqué. Prochaine attaque ${ts(mine.lastAttack + ATTACK_COOLDOWN)}.`);
  if (target.lastAttacked && now - target.lastAttacked < SAFE_AFTER_ATTACK) {
    return ephemeral(interaction, `😮‍💨 **${target.name}** vient d’être attaquée, elle est à l’abri jusqu’à ${ts(target.lastAttacked + SAFE_AFTER_ATTACK)}.`);
  }
  if (target.vault < MIN_LOOT_VAULT) return ephemeral(interaction, `❌ Le coffre de **${target.name}** est presque vide (💰 ${formatMoney(target.vault)}) : rien à piller.`);
  const sent = Math.min(interaction.options.getInteger('soldats') ?? mine.soldiers, mine.soldiers);

  mine.lastAttack = now;
  target.lastAttacked = now;
  const lines = [`⚔️ **${mine.name}** attaque **${target.name}** avec 🪖 **${sent}** soldat(s) !`, ''];
  let color;
  if (target.locks > 0) {
    // Un cadenas bloque l'attaque (et se brise) ; quelques soldats se blessent dessus.
    target.locks--;
    const lost = Math.ceil(sent * rand(0.05, 0.15));
    mine.soldiers -= lost;
    color = 0x95a5a6;
    lines.push(`🔒 Un cadenas de **${target.name}** bloque l’attaque et se brise (il lui en reste ${target.locks}).`, `🪖 ${mine.name} perd ${lost} soldat(s).`);
  } else {
    const defenders = target.soldiers;
    const won = sent * rand(0.7, 1.3) > defenders * rand(0.7, 1.3);
    const lossMine = Math.round(sent * (won ? rand(0.05, 0.2) : rand(0.3, 0.6)));
    const lossTheirs = Math.round(defenders * (won ? rand(0.3, 0.5) : rand(0.05, 0.2)));
    mine.soldiers -= lossMine;
    target.soldiers -= lossTheirs;
    const fight = `🪖 Pertes : ${mine.name} -${lossMine} · ${target.name} -${lossTheirs} (défendue par ${defenders} soldat(s))`;
    if (won) {
      const loot = Math.round(target.vault * rand(0.15, 0.3));
      target.vault -= loot;
      mine.vault += loot;
      mine.wins++;
      target.losses++;
      color = 0x2ecc71;
      lines.push(`🏆 **Victoire !** ${mine.name} pille 💰 **${formatMoney(loot)}** dans le coffre de ${target.name}.`, fight);
    } else {
      mine.losses++;
      target.wins++;
      color = 0xe74c3c;
      lines.push(`🛡️ **Défaite…** ${target.name} repousse l’attaque.`, fight);
    }
  }
  save(guild.id, mine);
  save(guild.id, target);
  lines.push('', `-# Prochaine attaque de ${mine.name} ${ts(now + ATTACK_COOLDOWN)}.`);
  return interaction.reply({
    content: `<@${target.ownerId}>`,
    embeds: [new EmbedBuilder().setColor(color).setTitle('⚔️ Attaque de team').setDescription(lines.join('\n'))],
    allowedMentions: { users: [target.ownerId] },
  });
}

export const TEAM_ACTIONS = {
  creer: create,
  inviter: invite,
  quitter: leave,
  expulser: kick,
  dissoudre: disband,
  info,
  deposer: deposit,
  retirer: withdraw,
  acheter: buy,
  attaquer: attack,
};
