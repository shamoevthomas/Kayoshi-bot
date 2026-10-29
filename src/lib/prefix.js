import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, InviteTargetType } from 'discord.js';
import { showBalance, moveMoney, rob, daily, pay, COOLDOWNS, KEEP_IN_POCKET } from './economy.js';
import { work, slut, mine, wagon, gift, rep } from './earnings.js';
import { shop, buy, ANTI_ROB } from './casinoshop.js';
import { TEAM_ACTIONS, TEAM_PRICE, SOLDIER_PRICE, LOCK_PRICE, teamOf } from './teams.js';
import { livret, RATE, PLAFOND } from './livret.js';
import { trade } from './trade.js';
import { playGame, GAME_RULES, ROULETTE_BETS } from './casino.js';
import { spinWheel } from './wheel.js';

// Commandes du casino avec le préfixe « . » (.balance, .dep, .bj…), écrites dans le chat.
// Les fonctions des commandes attendent une interaction : on en fabrique une à partir du message (ctx),
// dont reply / editReply répondent au message et modifient cette réponse.
const PREFIX = '.';
const hours = (ms) => `${ms / 3_600_000} h`;

function ctx(message, values = {}) {
  let sent = null;
  const clean = (payload) => {
    const { ephemeral, flags, ...rest } = typeof payload === 'string' ? { content: payload } : payload;
    return { ...rest, allowedMentions: { ...(rest.allowedMentions ?? {}), repliedUser: false } };
  };
  return {
    guild: message.guild,
    user: message.author,
    member: message.member,
    channel: message.channel,
    channelId: message.channelId,
    options: {
      getString: (name) => values[name] ?? null,
      getInteger: (name) => values[name] ?? null,
      getMember: (name) => values[name] ?? null,
      getUser: (name) => values[name]?.user ?? null,
    },
    reply: async (payload) => (sent = await message.reply(clean(payload))),
    editReply: async (payload) => sent?.edit(clean(payload)),
    followUp: async (payload) => message.channel.send(clean(payload)),
    fetchReply: async () => sent,
  };
}

// Membre visé : mention, ou identifiant.
async function memberArg(message, arg) {
  const id = arg?.match(/^<@!?(\d+)>$/)?.[1] ?? arg?.match(/^(\d{17,20})$/)?.[1];
  if (!id) return null;
  return message.guild.members.cache.get(id) ?? (await message.guild.members.fetch(id).catch(() => null));
}

// Une mise est obligatoire pour les jeux.
const needBet = (message, usage) => message.reply({ content: `❌ Indique ta mise : \`${usage}\` (ex : \`500\`, \`2k\`, \`all\`).`, allowedMentions: { repliedUser: false } });

// .activity : Poker Night (l'activité casino de Discord) dans le salon vocal du membre.
const POKER_NIGHT = '755827207812677713';
async function activity(message) {
  const voice = message.member?.voice?.channel;
  const reply = (p) => message.reply({ ...p, allowedMentions: { repliedUser: false } });
  if (!voice || voice.type !== ChannelType.GuildVoice) return reply({ content: '❌ Rejoins d’abord un salon vocal, puis refais `.activity`.' });
  const invite = await voice.createInvite({ targetType: InviteTargetType.EmbeddedApplication, targetApplication: POKER_NIGHT, maxAge: 3600 }).catch(() => null);
  if (!invite) return reply({ content: '❌ Je n’ai pas pu lancer l’activité (il me faut la permission « Créer une invitation » dans ce vocal).' });
  return reply({
    content: `🃏 **Poker Night** est prêt dans ${voice} : clique pour jouer avec ceux qui sont en vocal !`,
    components: [new ActionRowBuilder().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(invite.url).setLabel('Lancer Poker Night').setEmoji('🃏'))],
  });
}

// .team <action> … : les actions de lib/teams.js, avec leurs options lues dans le message.
const TEAM_HELP = [
  `\`.team creer <nom>\` — fonder une team (🪙 ${TEAM_PRICE})`,
  '`.team inviter @membre` · `.team expulser @membre` · `.team dissoudre` — chef',
  '`.team quitter` · `.team info [nom]`',
  '`.team deposer <montant|all>` · `.team retirer <montant|all>` (chef) — coffre commun',
  `\`.team acheter soldats <nombre>\` (🪖 ${SOLDIER_PRICE}) · \`.team acheter cadenas <nombre>\` (🔒 ${LOCK_PRICE}, 5 max)`,
  '`.team attaquer <nom> [soldats]` — piller le coffre d’une autre team (toutes les 2 h) ; chaque cadenas bloque une attaque',
].join('\n');
const TEAM_ALIASES = {
  creer: 'creer', créer: 'creer', create: 'creer',
  inviter: 'inviter', invite: 'inviter',
  quitter: 'quitter', leave: 'quitter',
  expulser: 'expulser', kick: 'expulser',
  dissoudre: 'dissoudre', disband: 'dissoudre', supprimer: 'dissoudre',
  info: 'info',
  deposer: 'deposer', déposer: 'deposer', dep: 'deposer',
  retirer: 'retirer', with: 'retirer',
  acheter: 'acheter', buy: 'acheter',
  attaquer: 'attaquer', attack: 'attaquer',
};
async function teamCommand(message, args) {
  const action = TEAM_ALIASES[(args[0] ?? '').toLowerCase()];
  const rest = args.slice(1);
  if (!action) {
    // .team seul : sa team, ou l'aide si on n'en a pas.
    if (!args.length && teamOf(message.guild.id, message.author.id)) return TEAM_ACTIONS.info(ctx(message));
    return message.reply({ embeds: [new EmbedBuilder().setColor(0x9b59b6).setTitle('👥 Teams').setDescription(TEAM_HELP)], allowedMentions: { repliedUser: false } });
  }
  const values = {};
  if (action === 'creer') values.nom = rest.join(' ');
  if (['inviter', 'expulser'].includes(action)) values.membre = (await memberArg(message, rest[0])) ?? undefined;
  if (action === 'info') values.team = rest.join(' ') || undefined;
  if (['deposer', 'retirer'].includes(action)) values.montant = rest[0];
  if (action === 'acheter') {
    values.objet = rest[0];
    values.quantite = /^\d+$/.test(rest[1] ?? '') ? Number(rest[1]) : undefined;
  }
  if (action === 'attaquer') {
    const last = rest.at(-1) ?? '';
    const count = /^\d+$/.test(last) && rest.length > 1 ? Number(last) : undefined;
    values.soldats = count;
    values.team = (count === undefined ? rest : rest.slice(0, -1)).join(' ');
  }
  return TEAM_ACTIONS[action](ctx(message, values));
}

// Les commandes, dans l'ordre du .help. usage = syntaxe ; short = ligne du .help ; details = .help <commande>.
const MONEY = [
  { name: 'activity', usage: '.activity', short: 'Lance l’activité Casino dans un vocal', details: 'Lance **Poker Night**, l’activité casino de Discord, dans le salon vocal où tu es.', run: (m) => activity(m) },
  {
    name: 'balance',
    aliases: ['bal', 'solde', 'money'],
    usage: '.balance [@user]',
    short: 'Affiche les coins du membre mentionné ou de l’auteur du message',
    details: 'Poche (peut être volée), banque et livret A (à l’abri), réputation, anti-vol, et le temps avant tes prochaines commandes.',
    run: async (m, a) => showBalance(ctx(m, { membre: (await memberArg(m, a[0])) ?? undefined })),
  },
  { name: 'daily', usage: '.daily', short: 'Donne une grosse somme de coins chaque jour', details: 'Une fois toutes les 24 h : 🪙 100, +10 par jour de série (jusqu’à 200).', run: (m) => daily(ctx(m)) },
  {
    name: 'dep',
    aliases: ['deposit', 'deposer'],
    usage: '.dep <amount/all>',
    short: 'Dépose votre argent en banque',
    details: `Met tes coins à la banque, à l’abri des vols. Tu gardes toujours au moins 🪙 ${KEEP_IN_POCKET} en poche (\`all\` = tout sauf ça).`,
    run: (m, a) => moveMoney(ctx(m, { montant: a[0] ?? 'tout' }), true),
  },
  { name: 'gift', usage: '.gift', short: 'Génère trois cartes, choisissez la bonne !', details: `Trois cartes : un gros lot, un petit lot et une carte vide. Toutes les ${hours(COOLDOWNS.gift)}.`, run: (m) => gift(ctx(m)) },
  {
    name: 'livret',
    usage: '.livret <dep/with> <montant|all>',
    short: 'Dépose ou retire de l’argent de votre livret A, ou consulte l’historique des intérêts',
    details: `Épargne à l’abri des vols qui rapporte **${RATE * 100} % par jour** (versés chaque nuit). Plafond : 🪙 ${PLAFOND.toLocaleString('fr-FR')}. \`.livret\` seul : solde et historique des intérêts.`,
    run: (m, a) => livret(ctx(m, { action: a[0], montant: a[1] ?? 'tout' })),
  },
  {
    name: 'mine',
    usage: '.mine',
    short: 'Mine des minerais',
    details: `Il faut un **wagon** (\`.shop\`). Charbon, fer, or… et parfois diamant ou émeraude, mis dans ton wagon : revends-les avec \`.wagon\`. Toutes les ${hours(COOLDOWNS.mine)}.`,
    run: (m) => mine(ctx(m)),
  },
  {
    name: 'pay',
    aliases: ['give', 'donner'],
    usage: '.pay <user> <amount/all>',
    short: 'Envoie de l’argent à un autre joueur',
    details: 'Donne des coins de ta poche à un membre.',
    run: async (m, a) => pay(ctx(m, { membre: (await memberArg(m, a[0])) ?? undefined, montant: a[1] })),
  },
  {
    name: 'rep',
    usage: '.rep <@member/teamname>',
    short: 'Vote pour un joueur',
    details: '+1 de réputation pour un membre ou une team, un vote par jour. Classements dans `/top`.',
    run: async (m, a) => {
      const membre = await memberArg(m, a[0]);
      return rep(ctx(m, { membre: membre ?? undefined, team: membre ? undefined : a.join(' ') || undefined }));
    },
  },
  {
    name: 'team',
    usage: '.team <action>',
    short: 'Teams : coffre commun, soldats, cadenas et attaques',
    details: TEAM_HELP,
    run: (m, a) => teamCommand(m, a),
  },
  {
    name: 'rob',
    aliases: ['voler'],
    usage: '.rob <@user>',
    short: 'Vole l’argent de la main d’un autre joueur',
    details: `45 % de réussite : tu voles 10 à 30 % de sa poche. Sinon, tu lui paies une amende. Toutes les ${hours(COOLDOWNS.rob)}. Protection : \`.dep\`, \`.livret\` ou \`.antivol\`.`,
    run: async (m, a) => rob(ctx(m, { membre: (await memberArg(m, a[0])) ?? undefined })),
  },
  {
    name: 'shop',
    aliases: ['boutique'],
    usage: '.shop',
    short: 'Boutique : bâtiments, anti-rob et wagon',
    details: 'Des bâtiments qui rapportent des coins toutes les 2 h (plus il est cher, plus il rapporte), l’anti-rob (3 h de protection contre les vols) et le wagon (débloque `.mine` et `.wagon`). Achat avec le menu, ou `.buy <objet>`.',
    run: (m) => shop(ctx(m)),
  },
  { name: 'buy', aliases: ['acheter'], usage: '.buy <objet>', short: 'Acheter un objet de la boutique', details: 'Ex : `.buy bar`, `.buy cinema`, `.buy anti-rob`, `.buy wagon`.', run: (m, a) => buy(ctx(m, { objet: a.join(' ') })) },
  { name: 'slut', usage: '.slut', short: 'Fais gagner une somme de coins', details: `Une soirée à risque : souvent un gros gain, parfois une perte. Toutes les ${hours(COOLDOWNS.slut)}.`, run: (m) => slut(ctx(m)) },
  {
    name: 'trade',
    usage: '.trade <@user> <amount> [objet]',
    short: 'Achète un objet à un membre',
    details: 'Propose un prix pour un objet (Nitro, compte, objet de jeu…). Le vendeur accepte avec un bouton, les coins passent de ta poche à la sienne, et l’échange est noté dans les logs.',
    run: async (m, a) => trade(ctx(m, { membre: (await memberArg(m, a[0])) ?? undefined, montant: a[1], objet: a.slice(2).join(' ') })),
  },
  {
    name: 'with',
    aliases: ['withdraw', 'retirer'],
    usage: '.with <amount/all>',
    short: 'Retire de l’argent de votre banque',
    details: 'Reprend des coins de la banque dans ta poche.',
    run: (m, a) => moveMoney(ctx(m, { montant: a[0] ?? 'tout' }), false),
  },
  { name: 'wagon', usage: '.wagon', short: 'Revends les minerais de ton wagon', details: 'Montre les minerais trouvés avec `.mine` et leur valeur, avec un bouton pour tout vendre. Il faut un wagon (`.shop`).', run: (m) => wagon(ctx(m)) },
  { name: 'work', usage: '.work', short: 'Fais gagner une somme de coins', details: `Un petit boulot, toujours payé. Toutes les ${hours(COOLDOWNS.work)}.`, run: (m) => work(ctx(m)) },
  {
    name: 'antivol',
    aliases: ['antirob'],
    usage: '.antivol',
    short: `Achète l’anti-rob de la boutique (🪙 ${ANTI_ROB.price.toLocaleString('fr-FR')})`,
    details: 'Comme `.buy anti-rob` : personne ne peut voler ta poche pendant 3 h.',
    run: (m) => buy(ctx(m, { objet: 'anti-rob' })),
  },
  { name: 'roue', aliases: ['wheel'], usage: '.roue', short: 'Roue de la fortune, une fois par jour', details: 'Argent, XP, booster d’XP… ou rien.', run: (m) => spinWheel(ctx(m)) },
];

const ROULETTE_HELP = Object.keys(ROULETTE_BETS).filter((k) => k !== 'numero').join(', ');
const GAMES = [
  { name: 'bj', aliases: ['blackjack'], usage: '.bj <mise>', short: 'Blackjack contre le croupier', details: GAME_RULES.bj, run: (m, a) => (a[0] ? playGame(ctx(m), 'bj', a[0]) : needBet(m, '.bj <mise>')) },
  { name: 'poker', usage: '.poker <mise>', short: 'Poker : garde tes cartes, change les autres', details: GAME_RULES.vp, run: (m, a) => (a[0] ? playGame(ctx(m), 'vp', a[0]) : needBet(m, '.poker <mise>')) },
  {
    name: 'roulette',
    usage: '.roulette <mise> <pari>',
    short: 'Roulette : couleur, parité, moitié, douzaine ou numéro',
    details: `${GAME_RULES.rl}\nParis : ${ROULETTE_HELP}, ou un numéro de 0 à 36 (ex : \`.roulette 500 rouge\`, \`.roulette 100 17\`).`,
    run: (m, a) => {
      const bet = (a[1] ?? '').toLowerCase();
      const option = /^\d+$/.test(bet) && Number(bet) <= 36 ? `n${Number(bet)}` : ROULETTE_BETS[bet] && bet !== 'numero' ? bet : null;
      if (!a[0] || !option) return m.reply({ content: `❌ Utilisation : \`.roulette <mise> <pari>\` — pari : ${ROULETTE_HELP}, ou un numéro de 0 à 36.`, allowedMentions: { repliedUser: false } });
      return playGame(ctx(m), 'rl', a[0], option);
    },
  },
  { name: 'slots', aliases: ['machine'], usage: '.slots <mise>', short: 'Machine à sous, jusqu’à ×200', details: GAME_RULES.sl, run: (m, a) => (a[0] ? playGame(ctx(m), 'sl', a[0]) : needBet(m, '.slots <mise>')) },
  {
    name: 'pf',
    aliases: ['coinflip', 'cf'],
    usage: '.pf <mise> <pile|face>',
    short: 'Pile ou face, mise ×2',
    details: GAME_RULES.pf,
    run: (m, a) => {
      const side = (a[1] ?? '').toLowerCase();
      if (!a[0] || !['pile', 'face'].includes(side)) return m.reply({ content: '❌ Utilisation : `.pf <mise> <pile|face>`.', allowedMentions: { repliedUser: false } });
      return playGame(ctx(m), 'pf', a[0], side);
    },
  },
];

const ALL = [...MONEY, ...GAMES];
const LOOKUP = new Map(ALL.flatMap((c) => [c.name, ...(c.aliases ?? [])].map((n) => [n, c])));
export const PREFIX_COMMANDS = ALL.map((c) => c.usage);

const line = (c) => `\`${c.usage}\`\n└ ${c.short}`;
function helpEmbed() {
  return new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('🪙 • Casino')
    .setDescription(`Utilisez \`.help [commande]\` pour plus de détails\n\n${[...MONEY].sort((a, b) => a.name.localeCompare(b.name)).map(line).join('\n')}\n\n**🎲 Jeux** _(mise : \`500\`, \`2k\`, \`all\`…)_\n${GAMES.map(line).join('\n')}`)
    .setFooter({ text: 'Coins du casino, séparés de l’argent des niveaux · /duel · classements : /top coins' });
}

function commandHelp(c) {
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle(`\`${c.usage}\``)
    .setDescription(`${c.short}\n\n${c.details}`);
  if (c.aliases?.length) embed.addFields({ name: 'Aussi', value: c.aliases.map((a) => `\`.${a}\``).join(' · ') });
  return embed;
}

// Renvoie true si le message était une commande « . » (traitée ici).
export async function handlePrefixCommand(message) {
  if (!message.guild || message.author.bot) return false;
  const content = message.content.trim();
  if (!content.startsWith(PREFIX)) return false;
  const [name = '', ...args] = content.slice(PREFIX.length).split(/\s+/);
  const key = name.toLowerCase();
  if (key === 'help' || key === 'aide') {
    const target = LOOKUP.get((args[0] ?? '').replace(/^\./, '').toLowerCase());
    await message.reply({ embeds: [target ? commandHelp(target) : helpEmbed()], allowedMentions: { repliedUser: false } });
    return true;
  }
  const command = LOOKUP.get(key);
  if (!command) return false;
  await command.run(message, args);
  return true;
}
