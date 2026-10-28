import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelSelectMenuBuilder, ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getCounting, setCounting } from './store.js';

// Comptage (/compteur) : dans le salon choisi, les membres écrivent 1, 2, 3… à tour de rôle, sans fin
// (BigInt : aucune limite de taille). Un message qui commence par un nombre compte ; le reste est de la
// discussion et n'est pas touché. Mauvais nombre, ou deux fois de suite le même membre : le message est
// refusé (❌ puis effacé avec un rappel du bon nombre), le compteur ne repart jamais à zéro.
const NUMBER = /^(\d+)(?!\S)/;
const ERROR_VISIBLE_MS = 4000;

export async function handleCountingMessage(message) {
  if (!message.guild || message.author.bot) return;
  const cfg = getCounting(message.guild.id);
  if (!cfg?.channelId || cfg.channelId !== message.channelId) return;
  const match = message.content.trim().match(NUMBER);
  if (!match) return;

  const current = BigInt(cfg.current ?? '0');
  const expected = current + 1n;
  const said = BigInt(match[1]);
  let problem = null;
  if (message.author.id === cfg.lastUserId) problem = `tu ne peux pas compter deux fois de suite : laisse quelqu’un d’autre écrire **${expected}**`;
  else if (said !== expected) problem = `il fallait écrire **${expected}**`;

  if (!problem) {
    const record = BigInt(cfg.record ?? '0');
    setCounting(message.guild.id, {
      ...cfg,
      current: said.toString(),
      lastUserId: message.author.id,
      record: (said > record ? said : record).toString(),
    });
    // 💯 à chaque centaine, ✅ sinon.
    await message.react(said % 100n === 0n ? '💯' : '✅').catch(() => {});
    return;
  }

  // Erreur : le compteur ne bouge pas. ❌, rappel du bon nombre, puis les deux messages sont effacés.
  await message.react('❌').catch(() => {});
  const notice = await message.channel.send({ content: `❌ ${message.author}, ${problem}.`, allowedMentions: { parse: [] } }).catch(() => null);
  setTimeout(() => {
    message.delete().catch(() => {});
    notice?.delete().catch(() => {});
  }, ERROR_VISIBLE_MS);
}

// --- Panneau de /compteur : boutons « cpt:activer », « cpt:desactiver », « cpt:voir » et menu « cpt:salon »
// (routés par interactionCreate, marchent après un redémarrage). Réservé à « Gérer le serveur ». ---
const ABOUT =
  'Dans le salon choisi, les membres écrivent **1, 2, 3…** sans fin, chacun leur tour (pas deux fois de suite). ' +
  'Une erreur est refusée (❌ puis effacée) : le compteur ne recommence jamais à zéro.';

export function counterPanel(guildId, notice = null, pickChannel = false) {
  const active = Boolean(getCounting(guildId)?.channelId);
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🔢 Compteur').setDescription(notice ? `${notice}\n\n-# ${ABOUT}` : ABOUT);
  const rows = [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cpt:activer').setLabel('Activer').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('cpt:desactiver').setLabel('Désactiver').setEmoji('⏹️').setStyle(ButtonStyle.Danger).setDisabled(!active),
      new ButtonBuilder().setCustomId('cpt:voir').setLabel('Voir').setEmoji('🔢').setStyle(ButtonStyle.Secondary),
    ),
  ];
  if (pickChannel) {
    rows.unshift(
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder().setCustomId('cpt:salon').setPlaceholder('Choisis le salon de comptage').addChannelTypes(ChannelType.GuildText),
      ),
    );
  }
  return { embeds: [embed], components: rows };
}

// Nouveau salon = on repart de 0 (le record est gardé si c'est le même salon qu'avant).
async function activate(guildId, channel) {
  const cfg = getCounting(guildId);
  const same = cfg?.channelId === channel.id || cfg?.lastChannelId === channel.id;
  setCounting(guildId, {
    channelId: channel.id,
    lastChannelId: channel.id,
    current: same ? (cfg.current ?? '0') : '0',
    record: same ? (cfg.record ?? '0') : '0',
    lastUserId: same ? (cfg.lastUserId ?? null) : null,
  });
  const next = same ? BigInt(cfg.current ?? '0') + 1n : 1n;
  await channel
    .send(`🔢 **Comptage !** Écrivez les nombres dans l’ordre, chacun votre tour, sans fin. Prochain nombre : **${next}**.\n-# Un mauvais nombre, ou deux fois de suite la même personne, est refusé : le compteur continue.`)
    .catch(() => {});
}

export async function handleCounterInteraction(interaction) {
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    return interaction.reply({ content: '❌ Il faut la permission « Gérer le serveur ».', ephemeral: true });
  }
  const { guild } = interaction;
  const action = interaction.customId.split(':')[1];
  const cfg = getCounting(guild.id);

  if (action === 'activer') return interaction.update(counterPanel(guild.id, '👇 Choisis le salon de comptage dans le menu.', true));
  if (action === 'salon') {
    const id = interaction.values[0];
    const channel = guild.channels.cache.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
    if (!channel?.isTextBased()) return interaction.update(counterPanel(guild.id, '❌ Salon introuvable, choisis-en un autre.', true));
    // Le réglage est enregistré tout de suite ; l'annonce dans le salon part sans faire attendre le panneau.
    activate(guild.id, channel).catch(() => {});
    return interaction.update(counterPanel(guild.id, `✅ Comptage activé dans ${channel}.`));
  }
  if (action === 'desactiver') {
    if (!cfg?.channelId) return interaction.update(counterPanel(guild.id, 'ℹ️ Le comptage n’était pas activé.'));
    setCounting(guild.id, { ...cfg, channelId: null });
    return interaction.update(counterPanel(guild.id, '⏹️ Comptage désactivé (le nombre atteint est gardé).'));
  }
  // voir
  return interaction.update(
    counterPanel(
      guild.id,
      cfg?.channelId
        ? `🔢 Salon : <#${cfg.channelId}> · nombre actuel : **${cfg.current ?? '0'}** · record : **${cfg.record ?? '0'}**`
        : 'ℹ️ Aucun salon de comptage : clique sur **Activer**.',
    ),
  );
}
