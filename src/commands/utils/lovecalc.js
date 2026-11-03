import { SlashCommandBuilder } from 'discord.js';
import { handleLoveSlash } from '../../lib/lovecalc.js';

// Pourcentage d'amour, de haine ou d'amitié entre deux personnes, comme ^^lc / ^^hc / ^^fc (voir lib/lovecalc.js).
export default {
  data: new SlashCommandBuilder()
    .setName('lovecalc')
    .setDescription('Pourcentage d’amour, de haine ou d’amitié entre deux personnes.')
    .addStringOption((o) =>
      o
        .setName('type')
        .setDescription('Amour (par défaut), haine ou amitié')
        .addChoices({ name: '❤️ Amour', value: 'love' }, { name: '💔 Haine', value: 'hate' }, { name: '⭐ Amitié', value: 'friendship' }),
    )
    .addUserOption((o) => o.setName('membre').setDescription('Avec qui ? (vide = un membre au hasard)'))
    .addUserOption((o) => o.setName('membre2').setDescription('Un 2ᵉ membre, pour comparer deux personnes entre elles'))
    .addStringOption((o) => o.setName('prenom').setDescription('Un prénom à la place d’un membre').setMaxLength(40))
    .setDMPermission(false),

  async execute(interaction) {
    return handleLoveSlash(interaction);
  },
};
