import { ActionRowBuilder, ButtonBuilder, ButtonStyle, SlashCommandBuilder } from 'discord.js';
import { divorce, getRelations } from '../../lib/family.js';
import { vraiFaux, getVraiFaux } from '../../lib/vraifaux.js';

const list = (ids) => `${ids.slice(0, 20).map((id) => `<@${id}>`).join(', ')}${ids.length > 20 ? ` et ${ids.length - 20} autre(s)` : ''}`;

export default {
  data: new SlashCommandBuilder()
    .setName('divorce')
    .setDescription('Annuler un de tes mariages virtuels, ou tous d’un coup.')
    .addUserOption((o) => o.setName('membre').setDescription('(Obligatoire si tu as plusieurs conjoints) la personne dont tu divorces'))
    .addStringOption((o) => vraiFaux(o.setName('tous').setDescription('Divorcer de tous tes conjoints d’un coup')))
    .setDMPermission(false),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const { spouses } = getRelations(guildId, interaction.user.id);
    if (!spouses.length) return interaction.reply({ content: 'ℹ️ Tu n’es pas marié(e).', ephemeral: true });

    // « tous » : divorce de tous les conjoints, après confirmation s'il y en a plusieurs.
    if (getVraiFaux(interaction.options, 'tous')) {
      if (spouses.length > 1) {
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('divorce_all_yes').setLabel(`Divorcer des ${spouses.length}`).setEmoji('💔').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('divorce_all_no').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
        );
        const ask = await interaction.reply({
          content: `⚠️ Tu vas divorcer de tes **${spouses.length}** conjoints : ${list(spouses)}. Tu confirmes ?`,
          components: [row],
          allowedMentions: { parse: [] },
          ephemeral: true,
          fetchReply: true,
        });
        const click = await ask.awaitMessageComponent({ filter: (i) => i.user.id === interaction.user.id, time: 30_000 }).catch(() => null);
        if (click?.customId !== 'divorce_all_yes') {
          return (click ?? interaction)[click ? 'update' : 'editReply']({ content: click ? '↩️ Divorces annulés.' : '⌛ Temps écoulé : divorces annulés.', components: [] }).catch(() => {});
        }
        await click.update({ content: '💔 C’est fait.', components: [] }).catch(() => {});
      }
      // Relu après la confirmation : un conjoint a pu divorcer entre-temps.
      const exes = getRelations(guildId, interaction.user.id).spouses;
      for (const ex of exes) divorce(guildId, interaction.user.id, ex);
      const content = !exes.length
        ? 'ℹ️ Tu n’es plus marié(e) à personne.'
        : exes.length === 1
          ? `💔 ${interaction.user} a divorcé de <@${exes[0]}>.`
          : `💔 ${interaction.user} a divorcé de tous ses conjoints (${exes.length}) : ${list(exes)}.`;
      return spouses.length > 1
        ? interaction.followUp({ content, allowedMentions: { parse: [] } })
        : interaction.reply({ content, allowedMentions: { parse: [] } });
    }

    const target = interaction.options.getUser('membre');
    let ex;
    if (target) {
      if (!spouses.includes(target.id)) return interaction.reply({ content: `❌ Tu n’es pas marié(e) à ${target}.`, ephemeral: true });
      ex = target.id;
    } else if (spouses.length === 1) {
      ex = spouses[0];
    } else {
      return interaction.reply({
        content: `❌ Tu es marié(e) à plusieurs personnes (${list(spouses)}) : précise avec l’option \`membre\` de qui tu divorces, ou mets \`tous\` pour divorcer de tout le monde.`,
        ephemeral: true,
      });
    }

    divorce(guildId, interaction.user.id, ex);
    await interaction.reply({ content: `💔 ${interaction.user} a divorcé de <@${ex}>.`, allowedMentions: { parse: [] } });
  },
};
