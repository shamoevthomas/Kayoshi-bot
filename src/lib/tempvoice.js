import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
} from 'discord.js';
import {
  getVoiceConfig,
  addTempVoice,
  getTempVoice,
  updateTempVoice,
  removeTempVoice,
  getAllTempVoice,
} from './store.js';

const P = PermissionFlagsBits;

function applyName(template, member) {
  return (template || 'Salon de [user]').replace(/\[user\]/gi, member.displayName).slice(0, 100);
}

// Panneau de contrôle envoyé dans le vocal temporaire.
export function buildControlPanel() {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🔊 Panneau de contrôle')
    .setDescription('Gère ton salon vocal avec les boutons ci-dessous (réservé au propriétaire).');
  const btn = (id, label, style, emoji) => new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style).setEmoji(emoji);
  const row1 = new ActionRowBuilder().addComponents(
    btn('tv_lock', 'Verrouiller', ButtonStyle.Secondary, '🔒'),
    btn('tv_unlock', 'Déverrouiller', ButtonStyle.Secondary, '🔓'),
    btn('tv_rename', 'Renommer', ButtonStyle.Primary, '✏️'),
    btn('tv_limit', 'Limite', ButtonStyle.Primary, '👥'),
  );
  const row2 = new ActionRowBuilder().addComponents(
    btn('tv_hide', 'Cacher', ButtonStyle.Secondary, '🙈'),
    btn('tv_show', 'Afficher', ButtonStyle.Secondary, '👁️'),
    btn('tv_kick', 'Expulser', ButtonStyle.Danger, '👢'),
    btn('tv_transfer', 'Transférer', ButtonStyle.Success, '👑'),
    btn('tv_claim', 'Récupérer', ButtonStyle.Success, '✅'),
  );
  return { embeds: [embed], components: [row1, row2] };
}

async function createTemp(newState, config) {
  const guild = newState.guild;
  const member = newState.member;
  const channel = await guild.channels.create({
    name: applyName(config.nameTemplate, member),
    type: ChannelType.GuildVoice,
    parent: config.categoryId ?? undefined,
    userLimit: config.defaultLimit || 0,
  });
  await member.voice.setChannel(channel).catch(() => {});
  addTempVoice(guild.id, channel.id, member.id);
  await channel.send(buildControlPanel()).catch(() => {});
}

// Appelé sur chaque voiceStateUpdate.
export async function handleVoiceState(oldState, newState) {
  const guild = newState.guild;
  const config = getVoiceConfig(guild.id);
  if (!config?.generatorChannelId) return;

  // Rejoint le salon générateur → création d'un vocal temporaire
  if (newState.channelId === config.generatorChannelId) {
    await createTemp(newState, config).catch((err) => console.error(err));
  }

  // Quitte un vocal temporaire désormais vide → suppression
  if (oldState.channelId && oldState.channelId !== newState.channelId) {
    const rec = getTempVoice(guild.id, oldState.channelId);
    if (rec) {
      const ch = oldState.channel ?? guild.channels.cache.get(oldState.channelId);
      if (ch && ch.members.size === 0) {
        await ch.delete('Vocal temporaire vide').catch(() => {});
        removeTempVoice(guild.id, oldState.channelId);
      }
    }
  }
}

// Nettoyage au démarrage : supprime les vocaux temporaires vides / disparus.
export async function reconcileTempVoice(client) {
  for (const [, guild] of client.guilds.cache) {
    const temp = getAllTempVoice(guild.id);
    for (const channelId of Object.keys(temp)) {
      const ch = guild.channels.cache.get(channelId);
      if (!ch) {
        removeTempVoice(guild.id, channelId);
      } else if (ch.members.size === 0) {
        await ch.delete('Vocal temporaire vide (redémarrage)').catch(() => {});
        removeTempVoice(guild.id, channelId);
      }
    }
  }
}

// --- Routeur des interactions "tv_" (panneau de contrôle) ---
export async function handleTempVoiceInteraction(interaction) {
  const id = interaction.customId ?? '';
  if (!id.startsWith('tv_')) return false;

  const channel = interaction.channel;
  const rec = getTempVoice(interaction.guild.id, channel.id);
  if (!rec) {
    await interaction.reply({ content: '❌ Ce salon n’est pas un vocal temporaire.', ephemeral: true });
    return true;
  }

  const isOwner = rec.ownerId === interaction.user.id;
  const isAdmin = interaction.memberPermissions?.has(P.ManageChannels);
  const everyone = interaction.guild.roles.everyone;

  // Récupérer la propriété (si le proprio n'est plus dans le salon)
  if (id === 'tv_claim') {
    const ownerInChannel = channel.members.has(rec.ownerId);
    if (ownerInChannel) {
      await interaction.reply({ content: '❌ Le propriétaire est encore dans le salon.', ephemeral: true });
      return true;
    }
    if (!channel.members.has(interaction.user.id)) {
      await interaction.reply({ content: '❌ Tu dois être dans le salon pour le récupérer.', ephemeral: true });
      return true;
    }
    updateTempVoice(interaction.guild.id, channel.id, { ownerId: interaction.user.id });
    await interaction.reply({ content: `👑 Tu es désormais propriétaire de ce salon.`, ephemeral: true });
    return true;
  }

  if (!isOwner && !isAdmin) {
    await interaction.reply({ content: '❌ Réservé au propriétaire du salon.', ephemeral: true });
    return true;
  }

  switch (id) {
    case 'tv_lock':
      await channel.permissionOverwrites.edit(everyone, { Connect: false });
      return void interaction.reply({ content: '🔒 Salon verrouillé.', ephemeral: true }), true;
    case 'tv_unlock':
      await channel.permissionOverwrites.edit(everyone, { Connect: null });
      return void interaction.reply({ content: '🔓 Salon déverrouillé.', ephemeral: true }), true;
    case 'tv_hide':
      await channel.permissionOverwrites.edit(everyone, { ViewChannel: false });
      return void interaction.reply({ content: '🙈 Salon caché.', ephemeral: true }), true;
    case 'tv_show':
      await channel.permissionOverwrites.edit(everyone, { ViewChannel: null });
      return void interaction.reply({ content: '👁️ Salon affiché.', ephemeral: true }), true;

    case 'tv_rename': {
      const modal = new ModalBuilder()
        .setCustomId('tv_renamemodal')
        .setTitle('Renommer le salon')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('name').setLabel('Nouveau nom').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100),
          ),
        );
      await interaction.showModal(modal);
      return true;
    }
    case 'tv_limit': {
      const modal = new ModalBuilder()
        .setCustomId('tv_limitmodal')
        .setTitle('Limite d’utilisateurs')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('limit').setLabel('Nombre (0 = illimité, max 99)').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2),
          ),
        );
      await interaction.showModal(modal);
      return true;
    }
    case 'tv_kick': {
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId('tv_kickselect').setPlaceholder('Qui expulser du salon ?').setMaxValues(1),
      );
      await interaction.reply({ content: 'Choisis le membre à expulser :', components: [row], ephemeral: true });
      return true;
    }
    case 'tv_transfer': {
      const row = new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId('tv_transferselect').setPlaceholder('Nouveau propriétaire').setMaxValues(1),
      );
      await interaction.reply({ content: 'À qui transférer la propriété ?', components: [row], ephemeral: true });
      return true;
    }

    case 'tv_renamemodal':
      await channel.setName(interaction.fields.getTextInputValue('name').slice(0, 100)).catch(() => {});
      return void interaction.reply({ content: '✏️ Salon renommé.', ephemeral: true }), true;
    case 'tv_limitmodal': {
      const n = Math.min(99, Math.max(0, parseInt(interaction.fields.getTextInputValue('limit'), 10) || 0));
      await channel.setUserLimit(n).catch(() => {});
      return void interaction.reply({ content: `👥 Limite réglée à ${n === 0 ? 'illimité' : n}.`, ephemeral: true }), true;
    }
    case 'tv_kickselect': {
      const target = interaction.values[0];
      const m = await interaction.guild.members.fetch(target).catch(() => null);
      if (m?.voice?.channelId === channel.id) await m.voice.disconnect('Expulsé du vocal temporaire').catch(() => {});
      return void interaction.update({ content: `👢 <@${target}> a été expulsé du salon.`, components: [] }), true;
    }
    case 'tv_transferselect': {
      const target = interaction.values[0];
      if (!channel.members.has(target)) {
        return void interaction.update({ content: '❌ Ce membre doit être dans le salon.', components: [] }), true;
      }
      updateTempVoice(interaction.guild.id, channel.id, { ownerId: target });
      return void interaction.update({ content: `👑 Propriété transférée à <@${target}>.`, components: [] }), true;
    }
  }
  return false;
}
