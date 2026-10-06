import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { getNickLocks } from '../../lib/store.js';

const MAX_CONTENT = 1900; // marge sous la limite Discord de 2000 caractères

export default {
  data: new SlashCommandBuilder()
    .setName('listepseudo')
    .setDescription('Voir les membres qui n’ont pas le droit de se renommer (pseudo verrouillé).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageNicknames)
    .setDMPermission(false),

  async execute(interaction) {
    const locks = Object.entries(getNickLocks(interaction.guild.id)).sort(([, a], [, b]) => b.at - a.at);
    if (!locks.length) return interaction.reply({ content: 'Aucun pseudo verrouillé.', ephemeral: true });

    let content = `🔒 **Pseudos verrouillés (${locks.length}) :**`;
    for (const [i, [userId, lock]] of locks.entries()) {
      const line = `\n• <@${userId}> → **${lock.nick ?? '(nom d’utilisateur)'}** — par <@${lock.by}> <t:${Math.floor(lock.at / 1000)}:R>`;
      if (content.length + line.length > MAX_CONTENT) {
        content += `\n… et ${locks.length - i} autre(s).`;
        break;
      }
      content += line;
    }
    await interaction.reply({ content, ephemeral: true });
  },
};
