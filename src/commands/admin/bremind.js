import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import { getBumpReminder, patchBumpReminder } from '../../lib/store.js';
import { roleMention } from '../../lib/bumpreminder.js';

export default {
  data: new SlashCommandBuilder()
    .setName('bremind')
    .setDescription('Activer ou désactiver le rappel de bump Disboard (2 h après chaque /bump).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const current = getBumpReminder(guildId);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('brm_on').setLabel('Activer').setStyle(ButtonStyle.Success).setEmoji('⏰'),
      new ButtonBuilder().setCustomId('brm_off').setLabel('Désactiver').setStyle(ButtonStyle.Danger),
    );

    const msg = await interaction.reply({
      content: `⏰ **Rappel de bump** — actuellement **${current.enabled ? 'activé' : 'désactivé'}**.\nActiver ou désactiver ?`,
      components: [row],
      ephemeral: true,
      fetchReply: true,
    });

    let choice;
    try {
      choice = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 60_000, filter: (i) => i.user.id === interaction.user.id });
    } catch {
      return interaction.editReply({ content: '⏳ Temps écoulé. Relance `/bremind`.', components: [] }).catch(() => {});
    }

    if (choice.customId === 'brm_off') {
      // Le rappel en attente est annulé : rien ne partira même en cas de réactivation.
      patchBumpReminder(guildId, { enabled: false, nextAt: null });
      return choice.update({ content: '🚫 Rappel de bump **désactivé**.', components: [] });
    }

    const cfg = patchBumpReminder(guildId, { enabled: true });
    return choice.update({
      content:
        '✅ Rappel de bump **activé** !\n' +
        'Dès qu’un membre fait `/bump` avec Disboard, je le remercie puis je mentionne le rôle **2 heures plus tard** dans le même salon.\n' +
        (cfg.roleId ? `• Rôle mentionné : ${roleMention(guildId, cfg.roleId).text.trim()}\n` : '• ⚠️ Aucun rôle à mentionner pour l’instant.\n') +
        'Personnalise le rappel, le rôle et le message après bump avec `/bremind-edit`.',
      components: [],
    });
  },
};
