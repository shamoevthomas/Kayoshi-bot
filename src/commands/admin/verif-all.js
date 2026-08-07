import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { forceVerifyAll } from '../../lib/verification.js';

export default {
  data: new SlashCommandBuilder()
    .setName('verif-all')
    .setDescription('Valider la vérification de TOUS les membres non vérifiés du serveur.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    // Action de masse → on demande une confirmation.
    const confirm = new ButtonBuilder()
      .setCustomId('verifall_confirm')
      .setLabel('Oui, tout vérifier')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🛡️');
    const cancel = new ButtonBuilder()
      .setCustomId('verifall_cancel')
      .setLabel('Annuler')
      .setStyle(ButtonStyle.Secondary);
    const row = new ActionRowBuilder().addComponents(confirm, cancel);

    const prompt = await interaction.reply({
      content:
        '⚠️ Tu vas **vérifier tous les membres non vérifiés** du serveur (leur donner le rôle de vérif). Confirmer ?',
      components: [row],
      ephemeral: true,
      fetchReply: true,
    });

    let choice;
    try {
      choice = await prompt.awaitMessageComponent({
        filter: (i) => i.user.id === interaction.user.id,
        time: 30_000,
      });
    } catch {
      await interaction.editReply({ content: '⏳ Temps écoulé, opération annulée.', components: [] }).catch(() => {});
      return;
    }

    if (choice.customId === 'verifall_cancel') {
      await choice.update({ content: '❌ Opération annulée.', components: [] }).catch(() => {});
      return;
    }

    await choice.update({ content: '⏳ Vérification en masse en cours…', components: [] }).catch(() => {});

    const res = await forceVerifyAll(interaction.guild, interaction.user).catch((err) => {
      console.error('[verif-all] échec :', err);
      return { ok: false, reason: 'error', message: err?.message };
    });

    if (!res.ok) {
      const messages = {
        'no-config': "❌ La vérification n'est pas configurée sur ce serveur (`/configverif`).",
        'fetch-failed': '❌ Impossible de récupérer la liste des membres.',
      };
      await interaction
        .editReply({ content: messages[res.reason] ?? `❌ Erreur : ${res.message ?? 'inconnue'}`, components: [] })
        .catch(() => {});
      return;
    }

    await interaction
      .editReply({
        content:
          `✅ **${res.verified}** membre(s) vérifié(s).\n` +
          `↪️ ${res.skipped} ignoré(s) (déjà vérifiés / bots)` +
          (res.failed ? `\n⚠️ ${res.failed} échec(s) — vérifie que mon rôle est au-dessus du rôle de vérif.` : ''),
        components: [],
      })
      .catch(() => {});
  },
};
