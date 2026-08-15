import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { runCreatorCommand } from '../../lib/creators.js';

const addOpts = (sub) =>
  sub
    .addStringOption((o) => o.setName('nom').setDescription('Pseudo Twitch (ex: ninja) ou URL de la chaîne').setRequired(true))
    .addChannelOption((o) =>
      o
        .setName('salon')
        .setDescription('Salon où poster les annonces de live')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true),
    )
    .addRoleOption((o) => o.setName('role').setDescription('(Facultatif) rôle à mentionner'))
    .addBooleanOption((o) => o.setName('everyone').setDescription('(Facultatif) mentionner @everyone'))
    .addBooleanOption((o) => o.setName('here').setDescription('(Facultatif) mentionner @here'));

export default {
  data: new SlashCommandBuilder()
    .setName('twitch')
    .setDescription('Suivre des chaînes Twitch : annoncer quand elles passent en live.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) => addOpts(sub.setName('ajouter').setDescription('Ajouter une chaîne Twitch à suivre.')))
    .addSubcommand((sub) =>
      sub
        .setName('retirer')
        .setDescription('Arrêter de suivre une chaîne Twitch.')
        .addStringOption((o) => o.setName('nom').setDescription('Le pseudo suivi').setRequired(true)),
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Voir les chaînes Twitch suivies.')),

  execute(interaction) {
    return runCreatorCommand(interaction, 'twitch');
  },
};
