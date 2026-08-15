import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { runCreatorCommand } from '../../lib/creators.js';

const addOpts = (sub) =>
  sub
    .addStringOption((o) => o.setName('nom').setDescription('@handle, URL ou ID de la chaîne YouTube').setRequired(true))
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
    .setName('youtubeur')
    .setDescription('Suivre des YouTubeurs : poster leurs nouvelles vidéos dans un salon.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) => addOpts(sub.setName('ajouter').setDescription('Ajouter un YouTubeur à suivre.')))
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('Arrêter de suivre un YouTubeur.')
        .addStringOption((o) => o.setName('nom').setDescription('Le @handle / nom suivi').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Voir les YouTubeurs suivis.')),

  execute(interaction) {
    return runCreatorCommand(interaction, 'youtube');
  },
};
