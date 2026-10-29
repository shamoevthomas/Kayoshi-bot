import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getCoins, addCoins, patchHeist, addRep, getCasinoInv, patchCasinoInv } from './store.js';
import { formatMoney } from './shop.js';
import { boostedMoney } from './levels.js';
import { COOLDOWNS, cooldownLeft, rand, ts } from './economy.js';
import { findTeam, repTeam } from './teams.js';

// Gagner de l'argent avec les commandes « . » : .work, .slut (risqué), .mine et .wagon (avec un wagon), .gift (3 cartes) et .rep.
// Chaque commande a son délai (COOLDOWNS dans lib/economy.js). Gains en poche, boostés par /boostrole.
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const between = (min, max) => Math.round(rand(min, max));
const wait = (interaction, key, text) => {
  const left = cooldownLeft(interaction.guild.id, interaction.user.id, key);
  if (!left) return null;
  return interaction.reply({ content: `⏳ ${text} Reviens ${ts(left)}.`, ephemeral: true });
};
const footer = (guildId, userId, cooldown) => `Poche : ${formatMoney(getCoins(guildId, userId))} · à nouveau dans ${Math.round(cooldown / 3_600_000)} h`;

// --- .work : un petit boulot, toujours payé ---
const JOBS = [
  '🏹 En archer d’élite, chaque flèche a fait mouche',
  '🍕 Tu as livré des pizzas toute la soirée',
  '💻 Tu as réparé l’ordinateur de ta voisine',
  '🎸 Tu as joué de la guitare dans le métro',
  '🧹 Tu as fait le ménage dans un château',
  '🐕 Tu as promené les chiens du quartier',
  '👨‍🍳 Tu as cuisiné dans un restaurant étoilé',
  '🚕 Tu as fait le taxi toute la nuit',
  '🎨 Tu as vendu une de tes peintures',
  '🍓 Tu as aidé à la récolte des fraises',
  '📦 Tu as trié des colis à l’entrepôt',
  '🎮 Tu as testé un jeu vidéo pas encore sorti',
  '✂️ Tu as tenu le salon de coiffure (feur)',
  '📚 Tu as donné des cours particuliers de maths',
  '🎤 Tu as chanté au karaoké et récolté les pourboires',
  '🧙 Tu as fait des tours de magie à un anniversaire',
  '🏗️ Tu as passé la journée sur un chantier',
  '🐟 Tu as vendu ta pêche du jour au marché',
];

export async function work(interaction) {
  const { guild, user } = interaction;
  const busy = wait(interaction, 'work', 'Tu as déjà travaillé.');
  if (busy) return busy;
  patchHeist(guild.id, user.id, { work: Date.now() });
  const gain = boostedMoney(interaction.member, between(40, 120));
  addCoins(guild.id, user.id, gain);
  const embed = new EmbedBuilder()
    .setColor(0xf1c40f)
    .setTitle('💼 Work')
    .setDescription(`${pick(JOBS)} et tu gagnes 🪙 **+${formatMoney(gain)}** !`)
    .setFooter({ text: footer(guild.id, user.id, COOLDOWNS.work) });
  return interaction.reply({ embeds: [embed] });
}

// --- .slut : une soirée à risque, gain plus gros ou perte ---
const NIGHT_WIN = [
  '🪩 Tu as mis le feu à la piste de danse, le DJ t’a payé pour revenir',
  '🎉 Tu as organisé la soirée de l’année et vendu toutes les places',
  '🍾 Tu as servi au bar VIP et les pourboires ont plu',
  '🎤 Tu as gagné le concours de karaoké de la boîte de nuit',
  '🕺 Tu as été payé pour danser dans un clip',
  '💃 Tu as animé un anniversaire de star',
];
const NIGHT_LOSE = [
  '🚫 Le videur t’a recalé à l’entrée, et tu as payé le taxi pour rien',
  '🍹 Tu as offert une tournée générale… à toute la boîte',
  '👟 Tu as perdu une chaussure sur la piste et tu as dû en racheter',
  '🚓 Tapage nocturne : amende',
  '📱 Tu as cassé ton téléphone en dansant',
];

export async function slut(interaction) {
  const { guild, user } = interaction;
  const busy = wait(interaction, 'slut', 'Tu es encore fatigué de ta dernière soirée.');
  if (busy) return busy;
  patchHeist(guild.id, user.id, { slut: Date.now() });
  const embed = new EmbedBuilder().setTitle('🌙 Slut');
  if (Math.random() < 0.65) {
    const gain = boostedMoney(interaction.member, between(80, 250));
    addCoins(guild.id, user.id, gain);
    embed.setColor(0x9b59b6).setDescription(`${pick(NIGHT_WIN)} : 🪙 **+${formatMoney(gain)}** !`);
  } else {
    const loss = Math.min(getCoins(guild.id, user.id), between(40, 120));
    addCoins(guild.id, user.id, -loss);
    embed.setColor(0xe74c3c).setDescription(`${pick(NIGHT_LOSE)} : 🪙 **-${formatMoney(loss)}**…`);
  }
  embed.setFooter({ text: footer(guild.id, user.id, COOLDOWNS.slut) });
  return interaction.reply({ embeds: [embed] });
}

// --- .mine : un minerai au hasard (ou un éboulement), mis dans le wagon ; .wagon le revend ---
// Il faut un wagon (.shop). Prix de revente fixes, boostés par /boostrole au moment de la vente.
export const ORES = [
  { id: 'charbon', name: 'Charbon', emoji: '⚫', weight: 40, price: 8, qty: [2, 6] },
  { id: 'fer', name: 'Fer', emoji: '🔩', weight: 28, price: 20, qty: [1, 4] },
  { id: 'or', name: 'Or', emoji: '🟡', weight: 14, price: 55, qty: [1, 3] },
  { id: 'diamant', name: 'Diamant', emoji: '💎', weight: 5, price: 200, qty: [1, 1] },
  { id: 'emeraude', name: 'Émeraude', emoji: '🟢', weight: 2, price: 400, qty: [1, 1] },
  { id: null, weight: 11 }, // éboulement : rien
];
const ORE_WEIGHT = ORES.reduce((n, o) => n + o.weight, 0);
const NO_WAGON = '🛒 Il te faut un **wagon** pour miner : 🪙 1 500 dans la boutique (`.shop` ou `.buy wagon`).';
const wagonValue = (ores) => ORES.filter((o) => o.id).reduce((n, o) => n + (ores[o.id] ?? 0) * o.price, 0);

export async function mine(interaction) {
  const { guild, user } = interaction;
  const inv = getCasinoInv(guild.id, user.id);
  if (!inv.wagon) return interaction.reply({ content: NO_WAGON, ephemeral: true });
  const busy = wait(interaction, 'mine', 'Ta pioche refroidit.');
  if (busy) return busy;
  patchHeist(guild.id, user.id, { mine: Date.now() });
  let roll = Math.random() * ORE_WEIGHT;
  const ore = ORES.find((o) => (roll -= o.weight) < 0) ?? ORES[0];
  const embed = new EmbedBuilder().setTitle('⛏️ Mine');
  if (!ore.id) {
    embed.setColor(0x95a5a6).setDescription('🪨 La galerie s’effondre devant toi… tu repars les mains vides.');
  } else {
    const qty = between(...ore.qty);
    const ores = { ...inv.ores, [ore.id]: (inv.ores[ore.id] ?? 0) + qty };
    patchCasinoInv(guild.id, user.id, { ores });
    const rare = ore.weight <= 5 ? ' **Quelle chance !**' : '';
    embed
      .setColor(0x2ecc71)
      .setDescription(
        `Tu as miné ${ore.emoji} **${qty} × ${ore.name}**${rare} (🪙 ${formatMoney(qty * ore.price)}), ajoutés à ton wagon.\n` +
          `🛒 Ton wagon vaut maintenant 🪙 **${formatMoney(wagonValue(ores))}** : revends-le avec \`.wagon\`.`,
      );
  }
  embed.setFooter({ text: `À nouveau dans ${Math.round(COOLDOWNS.mine / 3_600_000)} h` });
  return interaction.reply({ embeds: [embed] });
}

// .wagon : contenu du wagon, et bouton « wag:<membre> » pour tout revendre.
function wagonEmbed(ores, title = '🛒 Ton wagon') {
  const lines = ORES.filter((o) => o.id && ores[o.id]).map((o) => `${o.emoji} **${o.name}** × ${ores[o.id]} — 🪙 ${formatMoney(ores[o.id] * o.price)}`);
  return new EmbedBuilder()
    .setColor(0x8e6e53)
    .setTitle(title)
    .setDescription(lines.length ? `${lines.join('\n')}\n\n**Valeur :** 🪙 ${formatMoney(wagonValue(ores))}` : '_Ton wagon est vide : va miner avec `.mine`._');
}

export async function wagon(interaction) {
  const { guild, user } = interaction;
  const inv = getCasinoInv(guild.id, user.id);
  if (!inv.wagon) return interaction.reply({ content: NO_WAGON, ephemeral: true });
  const empty = !wagonValue(inv.ores);
  return interaction.reply({
    embeds: [wagonEmbed(inv.ores)],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`wag:${user.id}`).setLabel('Tout vendre').setEmoji('🪙').setStyle(ButtonStyle.Success).setDisabled(empty),
      ),
    ],
    allowedMentions: { parse: [] },
  });
}

export async function handleWagonInteraction(interaction) {
  const userId = interaction.customId.split(':')[1];
  if (interaction.user.id !== userId) return interaction.reply({ content: '❌ Ce n’est pas ton wagon : tape `.wagon`.', ephemeral: true });
  const { guild } = interaction;
  const inv = getCasinoInv(guild.id, userId);
  const value = wagonValue(inv.ores);
  if (!value) return interaction.update({ embeds: [wagonEmbed({})], components: [] });
  const gain = boostedMoney(interaction.member, value);
  patchCasinoInv(guild.id, userId, { ores: {} });
  addCoins(guild.id, userId, gain);
  const embed = wagonEmbed(inv.ores, '🛒 Wagon vendu').setColor(0x2ecc71).setFooter({ text: `+${formatMoney(gain)} · poche : ${formatMoney(getCoins(guild.id, userId))}` });
  return interaction.update({ embeds: [embed], components: [] });
}

// --- .gift : trois cartes retournées, une seule cache le gros lot ---
// Boutons gift:<partie>:<0|1|2>, partie en mémoire (après un redémarrage, la carte n'est plus valable).
const gifts = new Map();
const GIFT_MS = 60_000;

const giftRow = (game, reveal = false) =>
  new ActionRowBuilder().addComponents(
    game.prizes.map((prize, i) =>
      new ButtonBuilder()
        .setCustomId(`gift:${game.id}:${i}`)
        .setLabel(reveal ? (prize ? `+${formatMoney(prize)}` : 'Vide') : `Carte ${i + 1}`)
        .setEmoji(reveal ? (prize === Math.max(...game.prizes) ? '🪙' : prize ? '🪙' : '💨') : '🎴')
        .setStyle(reveal && i === game.choice ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setDisabled(reveal),
    ),
  );

export async function gift(interaction) {
  const { guild, user } = interaction;
  const busy = wait(interaction, 'gift', 'Tu as déjà ouvert un cadeau.');
  if (busy) return busy;
  patchHeist(guild.id, user.id, { gift: Date.now() });
  const prizes = [between(80, 200), between(10, 30), 0].map((p) => (p ? boostedMoney(interaction.member, p) : 0));
  for (let i = prizes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [prizes[i], prizes[j]] = [prizes[j], prizes[i]];
  }
  const game = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 5), guildId: guild.id, userId: user.id, prizes, choice: null };
  gifts.set(game.id, game);
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('🎁 Gift')
    .setDescription(`${user}, trois cartes sont posées devant toi. Une seule cache le gros lot : choisis la bonne !`)
    .setFooter({ text: 'Tu as 60 secondes' });
  game.message = await interaction.reply({ embeds: [embed], components: [giftRow(game)], allowedMentions: { parse: [] } });
  game.timer = setTimeout(() => {
    if (!gifts.delete(game.id)) return;
    embed.setColor(0x95a5a6).setDescription(`${user} n’a pas choisi à temps : les cartes s’envolent 💨`).setFooter(null);
    game.message?.edit?.({ embeds: [embed], components: [giftRow(game, true)] }).catch(() => {});
  }, GIFT_MS);
}

export async function handleGiftInteraction(interaction) {
  const [, id, index] = interaction.customId.split(':');
  const game = gifts.get(id);
  if (!game) return interaction.reply({ content: '⌛ Ces cartes ne sont plus valables.', ephemeral: true });
  if (interaction.user.id !== game.userId) return interaction.reply({ content: '❌ Ce cadeau n’est pas pour toi : tape `.gift`.', ephemeral: true });
  gifts.delete(id);
  clearTimeout(game.timer);
  game.choice = Number(index);
  const prize = game.prizes[game.choice];
  if (prize) addCoins(game.guildId, game.userId, prize);
  const best = prize === Math.max(...game.prizes);
  const embed = new EmbedBuilder()
    .setColor(best ? 0x2ecc71 : prize ? 0xf1c40f : 0xe74c3c)
    .setTitle('🎁 Gift')
    .setDescription(
      best
        ? `🎉 ${interaction.user} a trouvé le gros lot : 🪙 **+${formatMoney(prize)}** !`
        : prize
          ? `🪙 ${interaction.user} gagne un petit lot : 🪙 **+${formatMoney(prize)}**.`
          : `💨 ${interaction.user} a choisi la carte vide… Retente ta chance plus tard !`,
    )
    .setFooter({ text: footer(game.guildId, game.userId, COOLDOWNS.gift) });
  return interaction.update({ embeds: [embed], components: [giftRow(game, true)], allowedMentions: { parse: [] } });
}

// --- .rep @membre : +1 de réputation, une fois par jour ---
export async function rep(interaction) {
  const { guild, user } = interaction;
  const target = interaction.options.getMember('membre');
  // .rep <nom de team> : un vote pour une team (même limite d'un vote par jour).
  const teamQuery = interaction.options.getString('team');
  if (!target && teamQuery) {
    const team = findTeam(guild.id, teamQuery);
    if (!team) return interaction.reply({ content: `❌ Aucun membre ni team « ${teamQuery.slice(0, 50)} ».`, ephemeral: true });
    if (team.members.includes(user.id)) return interaction.reply({ content: '❌ Tu ne peux pas voter pour ta propre team.', ephemeral: true });
    const busy = wait(interaction, 'rep', 'Tu as déjà voté aujourd’hui.');
    if (busy) return busy;
    patchHeist(guild.id, user.id, { rep: Date.now() });
    const voted = repTeam(guild.id, team.id);
    return interaction.reply({ content: `⭐ ${user} vote pour la team **${voted.name}** ! Sa réputation passe à **${voted.rep}**.`, allowedMentions: { parse: [] } });
  }
  if (!target) return interaction.reply({ content: '❌ Mentionne le membre (ou écris le nom de la team) pour qui tu votes : `.rep @membre`.', ephemeral: true });
  if (target.user.bot) return interaction.reply({ content: '❌ On ne vote pas pour un bot.', ephemeral: true });
  if (target.id === user.id) return interaction.reply({ content: '❌ Tu ne peux pas voter pour toi-même.', ephemeral: true });
  const busy = wait(interaction, 'rep', 'Tu as déjà voté aujourd’hui.');
  if (busy) return busy;
  patchHeist(guild.id, user.id, { rep: Date.now() });
  const total = addRep(guild.id, target.id);
  return interaction.reply({
    content: `⭐ ${user} vote pour ${target} ! Sa réputation passe à **${total}**.\n-# Un vote par jour · classement : \`/top réputation\``,
    allowedMentions: { users: [target.id] },
  });
}

