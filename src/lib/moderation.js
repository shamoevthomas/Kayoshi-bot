import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits,
} from 'discord.js';
import { getWarns, addTempBan } from './store.js';
import { sendLog, Colors } from './logger.js';
import { parseDuration, formatDuration } from './time.js';

const SEVEN_DAYS_SECONDS = 604_800;

// Construit le panneau récapitulatif des warns + boutons Kick / Ban.
export function buildWarnPanel(targetUser, warns) {
  const embed = new EmbedBuilder()
    .setColor(Colors.delete)
    .setAuthor({ name: `${targetUser.tag}`, iconURL: targetUser.displayAvatarURL() })
    .setTitle(`⚠️ Cette personne a ${warns.length} avertissement(s)`)
    .setTimestamp();

  if (warns.length) {
    embed.setDescription(
      warns
        .slice(-10)
        .map(
          (w) =>
            `**#${w.id}** • <t:${Math.floor(w.ts / 1000)}:d> • par <@${w.moderatorId}>\n> ${w.reason}`,
        )
        .join('\n\n'),
    );
  } else {
    embed.setDescription('_Aucun avertissement._');
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mod_kick:${targetUser.id}`)
      .setLabel('Kick')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('👢'),
    new ButtonBuilder()
      .setCustomId(`mod_ban:${targetUser.id}`)
      .setLabel('Ban')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔨'),
  );

  return { embeds: [embed], components: [row] };
}

// Vérifie que l'utilisateur qui clique a bien les droits de modération.
function canModerate(interaction, flag) {
  return interaction.memberPermissions?.has(flag) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
}

// Routeur des interactions de modération (boutons + modals préfixés "mod_").
// Renvoie true si l'interaction a été gérée.
export async function handleModerationInteraction(interaction) {
  const id = interaction.customId ?? '';
  if (!id.startsWith('mod_')) return false;

  // --- Bouton Kick → formulaire motif ---
  if (interaction.isButton() && id.startsWith('mod_kick:')) {
    const userId = id.split(':')[1];
    const modal = new ModalBuilder()
      .setCustomId(`mod_kickmodal:${userId}`)
      .setTitle('Expulser ce membre')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('motif')
            .setLabel('Motif du kick')
            .setPlaceholder('ex : spam répété malgré avertissements')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(400),
        ),
      );
    await interaction.showModal(modal);
    return true;
  }

  // --- Modal Kick soumis → kick instantané ---
  if (interaction.isModalSubmit() && id.startsWith('mod_kickmodal:')) {
    const userId = id.split(':')[1];
    if (!canModerate(interaction, PermissionFlagsBits.KickMembers)) {
      await interaction.reply({ content: '❌ Tu n’as pas la permission d’expulser.', ephemeral: true });
      return true;
    }
    const reason = interaction.fields.getTextInputValue('motif');
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member) {
      await interaction.reply({ content: '❌ Membre introuvable (déjà parti ?).', ephemeral: true });
      return true;
    }
    if (!member.kickable) {
      await interaction.reply({ content: '❌ Je ne peux pas expulser ce membre (rôle trop haut ou permissions).', ephemeral: true });
      return true;
    }
    await member.kick(`${reason} — par ${interaction.user.tag}`);
    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.leave)
        .setAuthor({ name: '👢 Membre expulsé' })
        .setDescription(`${member.user.tag} (\`${userId}\`)`)
        .addFields(
          { name: 'Motif', value: reason },
          { name: 'Par', value: `${interaction.user}`, inline: true },
        )
        .setTimestamp(),
    );
    await interaction.reply({ content: `✅ **${member.user.tag}** a été expulsé.\nMotif : ${reason}`, ephemeral: true });
    return true;
  }

  // --- Bouton Ban → choix du type ---
  if (interaction.isButton() && id.startsWith('mod_ban:')) {
    const userId = id.split(':')[1];
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`mod_bantype:normal:${userId}`)
        .setLabel('Ban normal')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('🔨'),
      new ButtonBuilder()
        .setCustomId(`mod_bantype:def:${userId}`)
        .setLabel('Ban définitif (supprime 7j de messages)')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('💀'),
    );
    await interaction.reply({
      content:
        'Quel type de bannissement ?\n' +
        '🔨 **Ban normal** — bannit le compte.\n' +
        '💀 **Ban définitif** — bannit **et supprime tous ses messages des 7 derniers jours** (le max autorisé par Discord ; un vrai « ban IP » est impossible pour un bot).',
      components: [row],
      ephemeral: true,
    });
    return true;
  }

  // --- Bouton type de ban → formulaire durée + raison ---
  if (interaction.isButton() && id.startsWith('mod_bantype:')) {
    const [, type, userId] = id.split(':');
    const modal = new ModalBuilder()
      .setCustomId(`mod_banmodal:${type}:${userId}`)
      .setTitle(type === 'def' ? 'Ban définitif' : 'Ban normal')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('duree')
            .setLabel('Durée (ex : 7d, 12h, 30m — ou "perm")')
            .setPlaceholder('perm = permanent')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setValue('perm')
            .setMaxLength(12),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('raison')
            .setLabel('Raison')
            .setPlaceholder('ex : comportement toxique récurrent')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(400),
        ),
      );
    await interaction.showModal(modal);
    return true;
  }

  // --- Modal Ban soumis → bannissement ---
  if (interaction.isModalSubmit() && id.startsWith('mod_banmodal:')) {
    const [, type, userId] = id.split(':');
    if (!canModerate(interaction, PermissionFlagsBits.BanMembers)) {
      await interaction.reply({ content: '❌ Tu n’as pas la permission de bannir.', ephemeral: true });
      return true;
    }
    const dur = parseDuration(interaction.fields.getTextInputValue('duree'));
    if (dur === null) {
      await interaction.reply({ content: '❌ Durée invalide. Exemples : `7d`, `12h`, `30m`, ou `perm`.', ephemeral: true });
      return true;
    }
    const reason = interaction.fields.getTextInputValue('raison');
    const deleteMessageSeconds = type === 'def' ? SEVEN_DAYS_SECONDS : 0;

    const target = await interaction.client.users.fetch(userId).catch(() => null);
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (member && !member.bannable) {
      await interaction.reply({ content: '❌ Je ne peux pas bannir ce membre (rôle trop haut ou permissions).', ephemeral: true });
      return true;
    }

    await interaction.guild.bans.create(userId, {
      reason: `${reason} — par ${interaction.user.tag}`,
      deleteMessageSeconds,
    });

    let unbanNote = 'Bannissement **permanent**.';
    if (!dur.permanent) {
      addTempBan(interaction.guild.id, userId, Date.now() + dur.ms);
      unbanNote = `Débannissement automatique dans **${formatDuration(dur.ms)}**.`;
    }

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.delete)
        .setAuthor({ name: type === 'def' ? '💀 Ban définitif' : '🔨 Bannissement' })
        .setDescription(`${target?.tag ?? 'Utilisateur'} (\`${userId}\`)`)
        .addFields(
          { name: 'Durée', value: dur.permanent ? 'Permanent' : formatDuration(dur.ms), inline: true },
          { name: 'Messages supprimés', value: type === 'def' ? '7 jours' : 'Aucun', inline: true },
          { name: 'Raison', value: reason },
          { name: 'Par', value: `${interaction.user}`, inline: true },
        )
        .setTimestamp(),
    );

    await interaction.reply({
      content: `✅ **${target?.tag ?? userId}** a été banni.\n${unbanNote}\nRaison : ${reason}`,
      ephemeral: true,
    });
    return true;
  }

  return false;
}
