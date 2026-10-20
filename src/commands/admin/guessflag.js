import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { startGuessFlag, stopGuessFlag } from '../../lib/guessflag.js';
import { getGuessFlag } from '../../lib/store.js';

// Jeu « Devine le drapeau » dans un salon dédié (voir lib/guessflag.js).
export default {
  data: new SlashCommandBuilder()
    .setName('guessflag')
    .setDescription('Jeu « Devine le drapeau » dans un salon : chaque message est une réponse.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('activer')
        .setDescription('Lancer le jeu dans un salon (le classement est gardé).')
        .addChannelOption((o) =>
          o
            .setName('salon')
            .setDescription('Salon du jeu : tous les messages qui y sont envoyés sont supprimés')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText),
        ),
    )
    .addSubcommand((sub) => sub.setName('desactiver').setDescription('Arrêter le jeu (le classement est gardé).')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'desactiver') {
      const stopped = await stopGuessFlag(interaction.guild);
      return interaction.reply({ content: stopped ? '🛑 Jeu du drapeau arrêté.' : 'ℹ️ Aucune partie en cours.', ephemeral: true });
    }

    const channel = interaction.options.getChannel('salon', true);
    const needed = [
      [PermissionFlagsBits.ViewChannel, 'Voir le salon'],
      [PermissionFlagsBits.SendMessages, 'Envoyer des messages'],
      [PermissionFlagsBits.EmbedLinks, 'Intégrer des liens'],
      [PermissionFlagsBits.ManageMessages, 'Gérer les messages (supprimer les réponses)'],
    ];
    const perms = channel.permissionsFor(interaction.guild.members.me);
    const missing = needed.filter(([flag]) => !perms?.has(flag)).map(([, name]) => `**${name}**`);
    if (missing.length) {
      return interaction.reply({ content: `❌ Il me manque dans ${channel} : ${missing.join(', ')}.`, ephemeral: true });
    }

    const previous = getGuessFlag(interaction.guild.id)?.channelId;
    if (previous && previous !== channel.id) await stopGuessFlag(interaction.guild);
    await interaction.deferReply({ ephemeral: true });
    await startGuessFlag(channel);
    return interaction.editReply(
      `✅ Jeu du drapeau lancé dans ${channel} !\n` +
        '-# Chaque message envoyé dans ce salon est une réponse et est supprimé aussitôt. Une bonne réponse donne 1 point et passe au drapeau suivant.',
    );
  },
};
