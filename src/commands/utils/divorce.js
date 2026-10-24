import { SlashCommandBuilder } from 'discord.js';
import { divorce, getRelations } from '../../lib/family.js';

export default {
  data: new SlashCommandBuilder()
    .setName('divorce')
    .setDescription('Annuler un de tes mariages virtuels.')
    .addUserOption((o) => o.setName('membre').setDescription('(Obligatoire si tu as plusieurs conjoints) la personne dont tu divorces'))
    .setDMPermission(false),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const { spouses } = getRelations(guildId, interaction.user.id);
    if (!spouses.length) return interaction.reply({ content: 'ℹ️ Tu n’es pas marié(e).', ephemeral: true });

    const target = interaction.options.getUser('membre');
    let ex;
    if (target) {
      if (!spouses.includes(target.id)) return interaction.reply({ content: `❌ Tu n’es pas marié(e) à ${target}.`, ephemeral: true });
      ex = target.id;
    } else if (spouses.length === 1) {
      ex = spouses[0];
    } else {
      return interaction.reply({
        content: `❌ Tu es marié(e) à plusieurs personnes (${spouses.map((id) => `<@${id}>`).join(', ')}) : précise avec l’option \`membre\` de qui tu divorces.`,
        ephemeral: true,
      });
    }

    divorce(guildId, interaction.user.id, ex);
    await interaction.reply({ content: `💔 ${interaction.user} a divorcé de <@${ex}>.`, allowedMentions: { parse: [] } });
  },
};
