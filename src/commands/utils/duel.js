import { SlashCommandBuilder } from 'discord.js';
import { DUEL_GAMES, startDuel } from '../../lib/duel.js';

// Duel contre un membre, ou contre le bot si personne n'est choisi : morpion, puissance 4 ou
// pierre-feuille-ciseaux, mise facultative (voir lib/duel.js).
export default {
  data: new SlashCommandBuilder()
    .setName('duel')
    .setDescription('Morpion, puissance 4 ou pierre-feuille-ciseaux contre un membre ou contre le bot.')
    .addStringOption((o) =>
      o
        .setName('jeu')
        .setDescription('Le jeu')
        .setRequired(true)
        .addChoices(...Object.entries(DUEL_GAMES).map(([value, g]) => ({ name: `${g.emoji} ${g.label}`, value }))),
    )
    .addUserOption((o) => o.setName('membre').setDescription('Le membre à défier (vide = jouer contre le bot)'))
    .addStringOption((o) => o.setName('mise').setDescription('Mise en coins (ex : 500, 2k) : le gagnant remporte tout. Sans mise par défaut'))
    .setDMPermission(false),

  async execute(interaction) {
    return startDuel(interaction);
  },
};
