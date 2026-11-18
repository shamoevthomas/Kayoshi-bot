import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { recreateChannel, recreateProblem, confirmRow, confirmText } from '../../lib/recreate.js';

// /recreate (ancien /reset) : supprime un salon et le recrée à l'identique, après confirmation (voir lib/recreate.js ;
// aussi « +recreate »).
export default {
  data: new SlashCommandBuilder()
    .setName('recreate')
    .setDescription('Supprime un salon et le recrée à l’identique (même nom et mêmes permissions).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addChannelOption((o) => o.setName('salon').setDescription('Le salon à recréer (par défaut : le salon actuel)')),

  async execute(interaction) {
    const channel = interaction.options.getChannel('salon') ?? interaction.channel;
    const problem = recreateProblem(interaction.guild, channel);
    if (problem) return interaction.reply({ content: `❌ ${problem}`, ephemeral: true });

    const prompt = await interaction.reply({ content: confirmText(channel), components: [confirmRow()], ephemeral: true, fetchReply: true });
    let choice;
    try {
      choice = await prompt.awaitMessageComponent({ filter: (i) => i.user.id === interaction.user.id, time: 30_000 });
    } catch {
      return interaction.editReply({ content: '⏳ Temps écoulé, opération annulée.', components: [] }).catch(() => {});
    }
    if (choice.customId === 'recreate_no') return choice.update({ content: '❌ Opération annulée.', components: [] }).catch(() => {});

    await choice.update({ content: '⏳ Recréation du salon…', components: [] }).catch(() => {});
    try {
      const clone = await recreateChannel(channel, interaction.user);
      return interaction.editReply({ content: `✅ ${clone} a été recréé (même nom, mêmes permissions).`, components: [] }).catch(() => {});
    } catch (err) {
      console.error('[recreate] échec :', err);
      return interaction.editReply({ content: `❌ Échec : ${err?.message ?? 'erreur inconnue'}`, components: [] }).catch(() => {});
    }
  },
};
