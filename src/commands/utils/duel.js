import { SlashCommandBuilder } from 'discord.js';
import { DUEL_GAMES, startDuel } from '../../lib/duel.js';

// Duel contre un membre : morpion, puissance 4 ou pierre-feuille-ciseaux, mise facultative (voir lib/duel.js).
export default {
  data: new SlashCommandBuilder()
    .setName('duel')
    .setDescription('Défier un membre au morpion, au puissance 4 ou à pierre-feuille-ciseaux (avec une mise si tu veux).')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre à défier').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('jeu')
        .setDescription('Le jeu')
        .setRequired(true)
        .addChoices(...Object.entries(DUEL_GAMES).map(([value, g]) => ({ name: `${g.emoji} ${g.label}`, value }))),
    )
    .addStringOption((o) => o.setName('mise').setDescription('Mise de chacun (ex : 500, 2k) : le gagnant remporte tout. Sans mise par défaut'))
    .setDMPermission(false),

  async execute(interaction) {
    return startDuel(interaction);
  },
};
