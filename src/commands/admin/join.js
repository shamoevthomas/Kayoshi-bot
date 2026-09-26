import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
} from 'discord.js';
import { joinAndStay, leaveVoice } from '../../lib/voicestay.js';

export default {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Faire rejoindre un salon vocal au bot (il y reste, même vide).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const guild = interaction.guild;
    const current = guild.members.me?.voice.channelId ?? null;

    const rows = [
      new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('join_chan')
          .setPlaceholder('Choisis un salon vocal')
          .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice),
      ),
    ];
    if (current) {
      rows.push(
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('join_leave').setLabel('Quitter le vocal').setStyle(ButtonStyle.Danger).setEmoji('👋'),
        ),
      );
    }

    const msg = await interaction.reply({
      content:
        `🔊 **Quel salon vocal dois-je rejoindre ?**${current ? ` (actuellement : <#${current}>)` : ''}\n` +
        '-# J’y reste même s’il est vide, et j’y retourne après un redémarrage.',
      components: rows,
      ephemeral: true,
      fetchReply: true,
    });

    let choice;
    try {
      choice = await msg.awaitMessageComponent({ time: 60_000, filter: (i) => i.user.id === interaction.user.id });
    } catch {
      return interaction.editReply({ content: '⏱️ Temps écoulé, relance `/join`.', components: [] });
    }

    if (choice.customId === 'join_leave') {
      await choice.deferUpdate();
      await leaveVoice(guild);
      return interaction.editReply({ content: '👋 J’ai quitté le vocal.', components: [] });
    }

    const channel = guild.channels.cache.get(choice.values[0]);
    if (!channel?.joinable) {
      return choice.update({
        content: `❌ Je ne peux pas rejoindre ${channel ?? 'ce salon'} (il me faut **Voir le salon** et **Se connecter**, ou le salon est plein).`,
        components: [],
      });
    }

    await choice.deferUpdate();
    const confirmed = await joinAndStay(guild, channel);
    return interaction.editReply({
      content: confirmed
        ? `✅ J’ai rejoint ${channel} et j’y reste.`
        : `⚠️ Demande envoyée pour rejoindre ${channel}, mais Discord ne l’a pas encore confirmé. Vérifie que je suis bien dans le salon.`,
      components: [],
    });
  },
};
