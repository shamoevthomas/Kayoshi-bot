import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getAvisChannel, setAvisChannel } from '../../lib/store.js';

// Option facultative : système de tickets n°1 (/configticket) ou n°2
// (/configticket2). Sans choix, les deux systèmes sont concernés.
const ticketOption = (o) =>
  o
    .setName('ticket')
    .setDescription('Système de tickets concerné (les deux si vide)')
    .addChoices({ name: 'Ticket 1', value: 1 }, { name: 'Ticket 2', value: 2 });

const target = (slots) => (slots.length === 2 ? 'des tickets 1 et 2' : `du ticket ${slots[0]}`);

export default {
  data: new SlashCommandBuilder()
    .setName('avisticket')
    .setDescription('Salon où sont postés les avis (notes ⭐) laissés à la fermeture des tickets.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('activer')
        .setDescription('Choisir le salon des avis.')
        .addChannelOption((o) =>
          o
            .setName('salon')
            .setDescription('Salon où poster les avis')
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
            .setRequired(true),
        )
        .addIntegerOption(ticketOption),
    )
    .addSubcommand((sub) => sub.setName('desactiver').setDescription('Désactiver les avis.').addIntegerOption(ticketOption))
    .addSubcommand((sub) => sub.setName('voir').setDescription('Voir la configuration.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'voir') {
      const line = (slot) => {
        const channelId = getAvisChannel(guildId, slot);
        return `• **Ticket ${slot}** : ${channelId ? `avis postés dans <#${channelId}>` : 'avis désactivés'}`;
      };
      return interaction.reply({ content: `⭐ **Avis des tickets**\n${line(1)}\n${line(2)}`, ephemeral: true });
    }

    const ticket = interaction.options.getInteger('ticket');
    const slots = ticket ? [ticket] : [1, 2];

    if (sub === 'desactiver') {
      setAvisChannel(guildId, slots, null);
      return interaction.reply({ content: `🔕 Avis ${target(slots)} désactivés.`, ephemeral: true });
    }

    // activer
    const channel = interaction.options.getChannel('salon');
    const perms = channel.permissionsFor(interaction.guild.members.me);
    if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms.has(PermissionFlagsBits.EmbedLinks)) {
      return interaction.reply({
        content: `❌ Il me faut **Envoyer des messages** et **Intégrer des liens** dans ${channel}.`,
        ephemeral: true,
      });
    }
    setAvisChannel(guildId, slots, channel.id);
    return interaction.reply({
      content:
        `✅ Les avis ${target(slots)} seront postés dans ${channel}.\n` +
        `À la fermeture d'un ticket, le membre pourra **noter le support (1-5 ⭐)** et laisser un **commentaire** depuis son MP.`,
      ephemeral: true,
    });
  },
};
