import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Répond Pong ! et affiche la latence.'),
  async execute(interaction) {
    const sent = await interaction.reply({ content: 'Pong !', fetchReply: true });
    const latency = sent.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(`Pong ! 🏓 Latence : ${latency}ms | API : ${Math.round(interaction.client.ws.ping)}ms`);
  },
};
