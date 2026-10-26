import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getMoneyDrops, addMoney } from './store.js';
import { formatMoney } from './shop.js';
import { countQuestAction, checkQuests } from './quests.js';

// Drops d'argent (/configeconomie drops) : de temps en temps, un message dans un des salons choisis
// fait apparaître « 💰 X à gagner » avec un bouton ; le premier qui clique gagne.
// Le délai entre deux drops est tiré au hasard autour de la fréquence choisie (de 0,5× à 1,5×).
const EXPIRE_MS = 5 * 60_000;
const COLOR = 0xf5c542;
const nextDropAt = new Map(); // guildId → instant du prochain drop possible
const claimed = new Set(); // messages de drop déjà ramassés (ou expirés)

const randomDelay = (cfg) => cfg.everyMin * 60_000 * (0.5 + Math.random());
const randomAmount = (cfg) => cfg.min + Math.floor(Math.random() * (cfg.max - cfg.min + 1));

// À chaque message : fait apparaître un drop si le délai est écoulé (seulement dans les salons choisis,
// donc seulement là où des membres écrivent).
export async function maybeDropMoney(message) {
  if (!message.guild || message.author.bot) return;
  const cfg = getMoneyDrops(message.guild.id);
  if (!cfg?.enabled || !cfg.channelIds?.includes(message.channelId)) return;
  const now = Date.now();
  const next = nextDropAt.get(message.guild.id);
  // Premier message depuis le démarrage du bot : on programme le premier drop.
  if (next === undefined || now >= next) nextDropAt.set(message.guild.id, now + randomDelay(cfg));
  if (next === undefined || now < next) return;

  const amount = randomAmount(cfg);
  const drop = await message.channel
    .send({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR)
          .setTitle('💰 Drop d’argent !')
          .setDescription(`Le premier qui clique sur le bouton gagne 💰 **${formatMoney(amount)}** !`)
          .setFooter({ text: 'Disparaît dans 5 minutes' }),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`drop_claim:${amount}`).setLabel('Récupérer').setEmoji('💰').setStyle(ButtonStyle.Success),
        ),
      ],
    })
    .catch(() => null);
  if (drop) setTimeout(() => expire(drop, amount), EXPIRE_MS);
}

async function expire(drop, amount) {
  if (claimed.has(drop.id)) return;
  claimed.add(drop.id);
  await drop
    .edit({
      embeds: [new EmbedBuilder().setColor(0x4e5058).setTitle('💨 Drop envolé').setDescription(`Personne n’a ramassé les 💰 **${formatMoney(amount)}** à temps.`)],
      components: [],
    })
    .catch(() => {});
}

// Bouton « Récupérer » : le premier clic gagne (le message est aussitôt marqué ramassé).
export async function handleDropInteraction(interaction) {
  const amount = Number(interaction.customId.split(':')[1]);
  const drop = interaction.message;
  if (claimed.has(drop.id) || Date.now() - drop.createdTimestamp > EXPIRE_MS || !amount) {
    return interaction.reply({ content: '⌛ Trop tard, ce drop n’est plus disponible.', ephemeral: true });
  }
  claimed.add(drop.id);
  const balance = addMoney(interaction.guild.id, interaction.user.id, amount);
  await interaction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('🎉 Drop ramassé !')
        .setDescription(`${interaction.user} a récupéré 💰 **${formatMoney(amount)}** !`)
        .setFooter({ text: `Son solde : ${formatMoney(balance)} 💰` }),
    ],
    components: [],
  });
  countQuestAction(interaction.guild.id, interaction.user.id, 'drops');
  await checkQuests({ guild: interaction.guild, author: interaction.user, member: interaction.member, channel: interaction.channel });
}
