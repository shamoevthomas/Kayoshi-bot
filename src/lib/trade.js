import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getCoins, addCoins } from './store.js';
import { formatMoney, ensureShopLogChannel } from './shop.js';
import { parseAmount } from './economy.js';

// .trade @vendeur <prix> [objet] : l'acheteur propose un prix pour un objet (Nitro, compte, objet d'un
// jeu…). Le vendeur accepte ou refuse avec un bouton ; s'il accepte, l'argent passe de la poche de
// l'acheteur à la sienne et l'échange est noté dans #logs-boutique. Valable 10 min.
// Boutons trd:<acheteur>:<vendeur>:<prix>:<date>:<ok|no|cancel> (l'objet est lu dans l'embed).
const EXPIRE_MS = 10 * 60_000;

export async function trade(interaction) {
  const { guild, user } = interaction;
  const seller = interaction.options.getMember('membre');
  if (!seller) return interaction.reply({ content: '❌ Mentionne le vendeur : `.trade @membre 500 objet`.', ephemeral: true });
  if (seller.user.bot) return interaction.reply({ content: '❌ On n’achète rien à un bot.', ephemeral: true });
  if (seller.id === user.id) return interaction.reply({ content: '❌ Tu ne peux pas t’acheter quelque chose à toi-même.', ephemeral: true });
  const pocket = getCoins(guild.id, user.id);
  const price = parseAmount(interaction.options.getString('montant'), pocket);
  if (!price || price <= 0) return interaction.reply({ content: '❌ Indique un prix : `.trade @membre 500 objet` (ou `all`).', ephemeral: true });
  if (price > pocket) return interaction.reply({ content: `❌ Tu n’as que 🪙 **${formatMoney(pocket)}** en poche.`, ephemeral: true });
  const item = (interaction.options.getString('objet') ?? '').slice(0, 200) || 'un objet';
  const base = `trd:${user.id}:${seller.id}:${price}:${Date.now()}`;
  const embed = new EmbedBuilder()
    .setColor(0xe67e22)
    .setTitle('🤝 Proposition d’échange')
    .setDescription(`${user} veut acheter à ${seller} :`)
    .addFields({ name: 'Objet', value: item }, { name: 'Prix', value: `🪙 ${formatMoney(price)}`, inline: true })
    .setFooter({ text: 'Le vendeur accepte ou refuse · valable 10 min' });
  return interaction.reply({
    content: `${seller}`,
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`${base}:ok`).setLabel('Accepter').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${base}:no`).setLabel('Refuser').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`${base}:cancel`).setLabel('Annuler').setStyle(ButtonStyle.Secondary),
      ),
    ],
    allowedMentions: { users: [seller.id] },
  });
}

export async function handleTradeInteraction(interaction) {
  const [, buyerId, sellerId, priceStr, at, action] = interaction.customId.split(':');
  const price = Number(priceStr);
  const { guild, user } = interaction;
  const item = interaction.message.embeds[0]?.fields?.find((f) => f.name === 'Objet')?.value ?? 'un objet';
  const done = (color, text) =>
    interaction.update({
      content: '',
      embeds: [new EmbedBuilder().setColor(color).setTitle('🤝 Échange').setDescription(text).addFields({ name: 'Objet', value: item }, { name: 'Prix', value: `🪙 ${formatMoney(price)}`, inline: true })],
      components: [],
      allowedMentions: { parse: [] },
    });

  if (action === 'cancel') {
    if (user.id !== buyerId) return interaction.reply({ content: '❌ Seul l’acheteur peut annuler sa proposition.', ephemeral: true });
    return done(0x95a5a6, `✖️ <@${buyerId}> a annulé sa proposition.`);
  }
  if (user.id !== sellerId) return interaction.reply({ content: '❌ Seul le vendeur peut accepter ou refuser.', ephemeral: true });
  if (Date.now() - Number(at) > EXPIRE_MS) return done(0x95a5a6, '⌛ La proposition a expiré.');
  if (action === 'no') return done(0xe74c3c, `✖️ <@${sellerId}> a refusé la proposition de <@${buyerId}>.`);

  const pocket = getCoins(guild.id, buyerId);
  if (pocket < price) return done(0xe74c3c, `❌ <@${buyerId}> n’a plus que 🪙 **${formatMoney(pocket)}** en poche : échange annulé.`);
  addCoins(guild.id, buyerId, -price);
  addCoins(guild.id, sellerId, price);
  await done(0x2ecc71, `✅ Échange conclu : <@${buyerId}> a payé 🪙 **${formatMoney(price)}** à <@${sellerId}>.\n-# Le vendeur doit maintenant donner l’objet.`);
  // Trace pour le staff, en cas de litige (en arrière-plan).
  ensureShopLogChannel(guild)
    .then((channel) =>
      channel?.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xe67e22)
            .setAuthor({ name: '🤝 Échange entre membres (.trade)' })
            .setDescription(`<@${buyerId}> a acheté **${item}** à <@${sellerId}>`)
            .addFields({ name: 'Prix', value: `🪙 ${formatMoney(price)}`, inline: true }, { name: 'Message', value: `[Voir](${interaction.message.url})`, inline: true })
            .setTimestamp(),
        ],
        allowedMentions: { parse: [] },
      }),
    )
    .catch(() => {});
}
