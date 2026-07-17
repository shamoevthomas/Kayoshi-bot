import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ComponentType,
} from 'discord.js';
import { setGuildConfig, getGuildConfig } from '../../lib/store.js';

export default {
  data: new SlashCommandBuilder()
    .setName('log')
    .setDescription('Configurer le salon des logs du serveur.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const current = getGuildConfig(interaction.guild.id).logChannelId;

    const buttons = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('log_create')
        .setLabel('Créer un salon')
        .setStyle(ButtonStyle.Success)
        .setEmoji('➕'),
      new ButtonBuilder()
        .setCustomId('log_existing')
        .setLabel('Choisir un salon existant')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('📁'),
    );

    const intro = current
      ? `Salon de logs actuel : <#${current}>\n\nQue veux-tu faire ?`
      : 'Aucun salon de logs configuré.\n\nQue veux-tu faire ?';

    const msg = await interaction.reply({
      content: intro,
      components: [buttons],
      ephemeral: true,
      fetchReply: true,
    });

    let choice;
    try {
      choice = await msg.awaitMessageComponent({
        componentType: ComponentType.Button,
        time: 60_000,
        filter: (i) => i.user.id === interaction.user.id,
      });
    } catch {
      return interaction.editReply({ content: '⏱️ Temps écoulé, réessaie avec `/log`.', components: [] });
    }

    // --- Créer un nouveau salon dédié ---
    if (choice.customId === 'log_create') {
      const channel = await interaction.guild.channels.create({
        name: 'kayoshi-logs',
        type: ChannelType.GuildText,
        topic: 'Logs automatiques du serveur — Kayoshi.',
        permissionOverwrites: [
          { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: interaction.client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.EmbedLinks,
            ],
          },
        ],
      });
      setGuildConfig(interaction.guild.id, { logChannelId: channel.id });
      return choice.update({
        content: `✅ Salon de logs créé : <#${channel.id}>\nTous les événements seront enregistrés ici.`,
        components: [],
      });
    }

    // --- Choisir un salon existant ---
    const selectRow = new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId('log_select')
        .setPlaceholder('Choisis un salon texte')
        .addChannelTypes(ChannelType.GuildText),
    );
    await choice.update({ content: 'Sélectionne le salon où envoyer les logs :', components: [selectRow] });

    let selection;
    try {
      selection = await msg.awaitMessageComponent({
        componentType: ComponentType.ChannelSelect,
        time: 60_000,
        filter: (i) => i.user.id === interaction.user.id,
      });
    } catch {
      return interaction.editReply({ content: '⏱️ Temps écoulé, réessaie avec `/log`.', components: [] });
    }

    const channelId = selection.values[0];
    setGuildConfig(interaction.guild.id, { logChannelId: channelId });
    return selection.update({
      content: `✅ Salon de logs configuré : <#${channelId}>\nTous les événements seront enregistrés ici.`,
      components: [],
    });
  },
};
