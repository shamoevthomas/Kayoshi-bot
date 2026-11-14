import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { setConfessionChannels } from '../../lib/store.js';
import { confessionPanel } from '../../lib/confessions.js';

// Permissions dont le bot a besoin : dans le salon des confessions (publier, image, fil de
// réponses) et dans celui des logs (publier le log, avec l'image).
const LOG_NEEDS = [
  ['ViewChannel', 'Voir le salon'],
  ['SendMessages', 'Envoyer des messages'],
  ['EmbedLinks', 'Intégrer des liens'],
  ['AttachFiles', 'Joindre des fichiers'],
];
const CONFESSION_NEEDS = [
  ...LOG_NEEDS,
  ['CreatePublicThreads', 'Créer des fils publics'],
  ['SendMessagesInThreads', 'Envoyer des messages dans les fils'],
];

function missingPerms(guild, channel, needs) {
  const perms = channel.permissionsFor(guild.members.me);
  return needs.filter(([flag]) => !perms?.has(PermissionFlagsBits[flag])).map(([, label]) => `**${label}**`);
}

export default {
  data: new SlashCommandBuilder()
    .setName('configconfessions')
    .setDescription('Choisir le salon des confessions anonymes et celui des logs (auteurs visibles du staff).')
    .addChannelOption((o) =>
      o.setName('salon').setDescription('Salon où publier les confessions').setRequired(true).addChannelTypes(ChannelType.GuildText),
    )
    .addChannelOption((o) =>
      o
        .setName('logs')
        .setDescription('Salon des logs : auteur, texte et image de chaque confession et réponse')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const { guild } = interaction;
    const channel = interaction.options.getChannel('salon');
    const logChannel = interaction.options.getChannel('logs');
    if (logChannel.id === channel.id) {
      return interaction.reply({ content: '❌ Les logs révèlent les auteurs : choisis un salon de logs différent du salon des confessions.', ephemeral: true });
    }
    for (const [target, needs] of [
      [channel, CONFESSION_NEEDS],
      [logChannel, LOG_NEEDS],
    ]) {
      const missing = missingPerms(guild, target, needs);
      if (missing.length) {
        return interaction.reply({ content: `❌ Il me manque ces permissions dans ${target} : ${missing.join(', ')}.`, ephemeral: true });
      }
    }

    setConfessionChannels(guild.id, channel.id, logChannel.id);
    const panel = await channel.send(confessionPanel()).catch(() => null);
    await interaction.reply({
      content:
        (panel
          ? `✅ Les confessions anonymes seront publiées dans ${channel}. Le bouton pour en envoyer y est posté.`
          : `⚠️ Salon enregistré (${channel}), mais je n’ai pas pu y poster le bouton pour envoyer une confession.`) +
        `\n📋 Logs (auteur de chaque confession et réponse) : ${logChannel}. Pense à le réserver au staff.`,
      ephemeral: true,
    });
  },
};
