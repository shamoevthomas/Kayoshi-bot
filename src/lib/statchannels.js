import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionFlagsBits, StringSelectMenuBuilder } from 'discord.js';
import { getGuildConfig, setGuildConfig } from './store.js';
import { formatMoney } from './shop.js';

// Salons de statistiques (/salon-stats) : des salons vocaux verrouillés (on les voit, on ne peut pas y
// entrer) dans une catégorie en haut du serveur, dont le nom affiche un chiffre à jour.
// Discord limite les renommages (2 toutes les 10 min par salon) : mise à jour toutes les 10 min, et
// seulement si le chiffre a changé. Réglages : data[guildId].statChannels = { categoryId, channels: { stat: id } }.
// Panneau : menu « sst:choix », boutons « sst:maj » et « sst:suppr » (routés par interactionCreate).
export const REFRESH_MS = 10 * 60_000;
const CATEGORY_NAME = '📊 Statistiques';

const humans = (g) => g.members.cache.filter((m) => !m.user.bot);
export const STATS = {
  membres: { emoji: '👥', label: 'Membres', about: 'membres, sans les bots', value: (g) => humans(g).size },
  enligne: {
    emoji: '🟢',
    label: 'En ligne',
    about: 'membres connectés (en ligne, absent, ne pas déranger)',
    value: (g) => g.presences.cache.filter((p) => p.status !== 'offline' && !g.members.cache.get(p.userId)?.user.bot).size,
  },
  vocal: { emoji: '🎙️', label: 'En vocal', about: 'membres en salon vocal', value: (g) => g.voiceStates.cache.filter((v) => v.channelId && !v.member?.user.bot).size },
  boosts: { emoji: '⚡', label: 'Boosts', about: 'boosts du serveur', value: (g) => g.premiumSubscriptionCount ?? 0 },
};

const getConfig = (guildId) => getGuildConfig(guildId).statChannels ?? { categoryId: null, channels: {} };
const setConfig = (guildId, cfg) => setGuildConfig(guildId, { statChannels: cfg });
const channelName = (guild, key) => `${STATS[key].emoji} ${STATS[key].label} : ${formatMoney(STATS[key].value(guild))}`;

async function fetchChannel(guild, id) {
  if (!id) return null;
  return guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
}

// Tous les membres en cache (le compte « membres » en a besoin).
async function loadMembers(guild) {
  if (guild.members.cache.size < guild.memberCount) await guild.members.fetch().catch(() => {});
}

// Chacun voit les salons, personne ne peut s'y connecter (le bot garde la main pour les renommer).
const lockedOverwrites = (guild) => [
  { id: guild.roles.everyone.id, allow: [PermissionFlagsBits.ViewChannel], deny: [PermissionFlagsBits.Connect] },
  { id: guild.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.ManageChannels] },
];

// Crée les salons cochés qui manquent, supprime les autres. Renvoie un message d'erreur, ou null.
async function apply(guild, keys) {
  const cfg = getConfig(guild.id);
  for (const [key, id] of Object.entries(cfg.channels)) {
    if (keys.includes(key)) continue;
    await (await fetchChannel(guild, id))?.delete('Salon de statistiques retiré (/salon-stats)').catch(() => {});
    delete cfg.channels[key];
  }
  let category = await fetchChannel(guild, cfg.categoryId);
  if (!keys.length) {
    if (category && !category.children?.cache.size) await category.delete('Plus de salons de statistiques').catch(() => {});
    setConfig(guild.id, { categoryId: null, channels: {} });
    return null;
  }
  if (!category) {
    category = await guild.channels
      .create({ name: CATEGORY_NAME, type: ChannelType.GuildCategory, position: 0, permissionOverwrites: lockedOverwrites(guild) })
      .catch(() => null);
    if (!category) return 'Je n’ai pas pu créer la catégorie : il me faut la permission « Gérer les salons ».';
    cfg.categoryId = category.id;
  }
  await loadMembers(guild);
  let error = null;
  for (const key of Object.keys(STATS).filter((k) => keys.includes(k))) {
    if (await fetchChannel(guild, cfg.channels[key])) continue;
    const channel = await guild.channels
      .create({ name: channelName(guild, key), type: ChannelType.GuildVoice, parent: category.id, permissionOverwrites: lockedOverwrites(guild) })
      .catch((err) => {
        error = `Je n’ai pas pu créer un salon (${err.message}).`;
        return null;
      });
    if (channel) cfg.channels[key] = channel.id;
  }
  setConfig(guild.id, cfg);
  return error;
}

// Met à jour les noms d'un serveur (seulement ceux qui changent). Un salon supprimé à la main est oublié.
export async function refreshGuildStats(guild) {
  const cfg = getConfig(guild.id);
  if (!Object.keys(cfg.channels).length) return;
  await loadMembers(guild);
  let changed = false;
  for (const [key, id] of Object.entries(cfg.channels)) {
    const channel = await fetchChannel(guild, id);
    if (!channel || !STATS[key]) {
      delete cfg.channels[key];
      changed = true;
      continue;
    }
    const name = channelName(guild, key);
    // Sans attendre : en cas de limite de Discord, discord.js patiente sans bloquer les autres salons.
    if (channel.name !== name) channel.setName(name).catch(() => {});
  }
  if (changed) setConfig(guild.id, cfg);
}

export async function refreshAllStatChannels(client) {
  for (const guild of client.guilds.cache.values()) await refreshGuildStats(guild).catch((err) => console.error('[salon-stats]', err));
}

export function statPanel(guild, notice = null) {
  const cfg = getConfig(guild.id);
  const active = Object.keys(STATS).filter((k) => cfg.channels[k]);
  const lines = active.length ? active.map((k) => `• <#${cfg.channels[k]}>`).join('\n') : '_Aucun salon de statistiques pour l’instant._';
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📊 Salons de statistiques')
    .setDescription(
      `${notice ? `${notice}\n\n` : ''}Des salons vocaux verrouillés, en haut du serveur, dont le nom affiche un chiffre à jour ` +
        `(toutes les 10 min, la limite de Discord).\n\n${lines}`,
    )
    .setFooter({ text: 'Coche les statistiques à afficher dans le menu ; décoche pour supprimer un salon.' });
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('sst:choix')
          .setPlaceholder('Choisis les statistiques à afficher')
          .setMinValues(0)
          .setMaxValues(Object.keys(STATS).length)
          .addOptions(Object.entries(STATS).map(([value, s]) => ({ label: s.label, value, emoji: s.emoji, description: s.about, default: active.includes(value) }))),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('sst:maj').setLabel('Mettre à jour maintenant').setEmoji('🔄').setStyle(ButtonStyle.Primary).setDisabled(!active.length),
        new ButtonBuilder().setCustomId('sst:suppr').setLabel('Tout supprimer').setEmoji('🗑️').setStyle(ButtonStyle.Danger).setDisabled(!active.length),
      ),
    ],
  };
}

export async function handleStatChannelsInteraction(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels)) {
    return interaction.reply({ content: '❌ Il faut la permission « Gérer les salons ».', ephemeral: true });
  }
  const { guild } = interaction;
  const action = interaction.customId.split(':')[1];
  if (action === 'maj') {
    refreshGuildStats(guild).catch(() => {});
    return interaction.update(statPanel(guild, '🔄 Mise à jour lancée (Discord autorise 2 changements de nom par salon toutes les 10 min).'));
  }
  // Créer ou supprimer des salons peut prendre plus de 3 s.
  await interaction.deferUpdate();
  const keys = action === 'suppr' ? [] : interaction.values;
  const error = await apply(guild, keys);
  const notice = error ? `❌ ${error}` : keys.length ? '✅ Salons de statistiques à jour.' : '🗑️ Salons de statistiques supprimés.';
  return interaction.editReply(statPanel(guild, notice));
}
