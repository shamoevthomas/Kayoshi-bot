import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { getCoiffeurEnabled, setCoiffeurEnabled } from '../../lib/store.js';

export default {
  data: new SlashCommandBuilder()
    .setName('coiffeur')
    .setDescription('Le bot répond « feur » quand un membre finit sa phrase par « quoi ».')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const current = getCoiffeurEnabled(guildId);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('coiffeur_on').setLabel('Activer').setStyle(ButtonStyle.Success).setEmoji('💇'),
      new ButtonBuilder().setCustomId('coiffeur_off').setLabel('Désactiver').setStyle(ButtonStyle.Danger),
    );

    const msg = await interaction.reply({
      content: `💇 **Mode coiffeur** — actuellement **${current ? 'activé' : 'désactivé'}**.\nActiver ou désactiver ?`,
      components: [row],
      ephemeral: true,
      fetchReply: true,
    });

    let choice;
    try {
      choice = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 60_000, filter: (i) => i.user.id === interaction.user.id });
    } catch {
      return interaction.editReply({ content: '⏳ Temps écoulé. Relance `/coiffeur`.', components: [] }).catch(() => {});
    }

    const enabled = choice.customId === 'coiffeur_on';
    setCoiffeurEnabled(guildId, enabled);
    return choice.update({
      content: enabled
        ? '✅ Mode coiffeur **activé** : « quoi » → « feur », « pourquoi » → « pour feur ». 💇'
        : '🚫 Mode coiffeur **désactivé**.',
      components: [],
    });
  },
};
