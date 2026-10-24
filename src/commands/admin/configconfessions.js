import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { setConfessionChannel } from '../../lib/store.js';
import { confessionPanel } from '../../lib/confessions.js';

// Permissions dont le bot a besoin dans le salon (publier, image, fil de réponses).
const NEEDED = [
  ['ViewChannel', 'Voir le salon'],
  ['SendMessages', 'Envoyer des messages'],
  ['EmbedLinks', 'Intégrer des liens'],
  ['AttachFiles', 'Joindre des fichiers'],
  ['CreatePublicThreads', 'Créer des fils publics'],
  ['SendMessagesInThreads', 'Envoyer des messages dans les fils'],
];

export default {
  data: new SlashCommandBuilder()
    .setName('configconfessions')
    .setDescription('Choisir le salon des confessions anonymes (le bouton pour en envoyer y est publié).')
    .addChannelOption((o) =>
      o.setName('salon').setDescription('Salon où publier les confessions').setRequired(true).addChannelTypes(ChannelType.GuildText),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const channel = interaction.options.getChannel('salon');
    const perms = channel.permissionsFor(interaction.guild.members.me);
    const missing = NEEDED.filter(([flag]) => !perms?.has(PermissionFlagsBits[flag])).map(([, label]) => `**${label}**`);
    if (missing.length) {
      return interaction.reply({ content: `❌ Il me manque ces permissions dans ${channel} : ${missing.join(', ')}.`, ephemeral: true });
    }

    setConfessionChannel(interaction.guild.id, channel.id);
    const panel = await channel.send(confessionPanel()).catch(() => null);
    await interaction.reply({
      content: panel
        ? `✅ Les confessions anonymes seront publiées dans ${channel}. Le bouton pour en envoyer y est posté.`
        : `⚠️ Salon enregistré (${channel}), mais je n’ai pas pu y poster le bouton pour envoyer une confession.`,
      ephemeral: true,
    });
  },
};
