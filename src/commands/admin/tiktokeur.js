import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { runCreatorCommand } from '../../lib/creators.js';

const addOpts = (sub) =>
  sub
    .addStringOption((o) => o.setName('nom').setDescription('@pseudo TikTok (ex: @charlidamelio)').setRequired(true))
    .addChannelOption((o) =>
      o
        .setName('salon')
        .setDescription('Salon où poster les nouvelles vidéos')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    )
    .addRoleOption((o) => o.setName('role').setDescription('(Facultatif) rôle à mentionner'))
    .addBooleanOption((o) => o.setName('everyone').setDescription('(Facultatif) mentionner @everyone'))
    .addBooleanOption((o) => o.setName('here').setDescription('(Facultatif) mentionner @here'));

export default {
  data: new SlashCommandBuilder()
    .setName('tiktokeur')
    .setDescription('Suivre des TikTokeurs : poster leurs nouvelles vidéos dans un salon.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) => addOpts(sub.setName('ajouter').setDescription('Ajouter un TikTokeur à suivre.')))
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('Arrêter de suivre un TikTokeur.')
        .addStringOption((o) => o.setName('nom').setDescription('Le @pseudo suivi').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Voir les TikTokeurs suivis.')),

  execute(interaction) {
    return runCreatorCommand(interaction, 'tiktok');
  },
};
