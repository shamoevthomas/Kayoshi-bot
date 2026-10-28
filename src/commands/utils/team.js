import { SlashCommandBuilder } from 'discord.js';
import { TEAM_ACTIONS, TEAM_PRICE, SOLDIER_PRICE, LOCK_PRICE, teamChoices } from '../../lib/teams.js';

// Teams : coffre commun, soldats, cadenas et attaques entre teams (voir lib/teams.js).
const amount = (o) => o.setName('montant').setDescription('Ex : 500, 2k, moitié (tout par défaut)');
const teamName = (o, required) => o.setName('team').setDescription('Le nom de la team').setAutocomplete(true).setRequired(required);

export default {
  data: new SlashCommandBuilder()
    .setName('team')
    .setDescription('Teams : coffre commun, soldats, cadenas et attaques contre les autres teams.')
    .addSubcommand((s) =>
      s
        .setName('creer')
        .setDescription(`Fonder une team (💰 ${TEAM_PRICE}).`)
        .addStringOption((o) => o.setName('nom').setDescription('Le nom de la team (2 à 24 caractères)').setRequired(true).setMaxLength(24)),
    )
    .addSubcommand((s) =>
      s
        .setName('inviter')
        .setDescription('Inviter un membre dans ta team (chef).')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre à inviter').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('quitter').setDescription('Quitter ta team (si tu es le chef, le suivant prend ta place).'))
    .addSubcommand((s) =>
      s
        .setName('expulser')
        .setDescription('Expulser un membre de ta team (chef).')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre à expulser').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('dissoudre').setDescription('Dissoudre ta team : le coffre est partagé entre les membres (chef).'))
    .addSubcommand((s) =>
      s
        .setName('info')
        .setDescription('Voir une team : membres, coffre, soldats, cadenas, combats.')
        .addStringOption((o) => teamName(o, false)),
    )
    .addSubcommand((s) => s.setName('deposer').setDescription('Mettre de ton argent (poche) dans le coffre de la team.').addStringOption(amount))
    .addSubcommand((s) => s.setName('retirer').setDescription('Reprendre de l’argent du coffre dans ta poche (chef).').addStringOption(amount))
    .addSubcommand((s) =>
      s
        .setName('acheter')
        .setDescription('Acheter des soldats ou des cadenas avec le coffre.')
        .addStringOption((o) =>
          o
            .setName('objet')
            .setDescription('Quoi acheter')
            .setRequired(true)
            .addChoices(
              { name: `🪖 Soldats (💰 ${SOLDIER_PRICE} chacun) : pour attaquer et se défendre`, value: 'soldats' },
              { name: `🔒 Cadenas (💰 ${LOCK_PRICE} chacun, 5 max) : chacun bloque une attaque`, value: 'cadenas' },
            ),
        )
        .addIntegerOption((o) => o.setName('quantite').setDescription('Combien (1 par défaut)').setMinValue(1).setMaxValue(10_000)),
    )
    .addSubcommand((s) =>
      s
        .setName('attaquer')
        .setDescription('Envoyer tes soldats piller le coffre d’une autre team (toutes les 2 h).')
        .addStringOption((o) => teamName(o, true))
        .addIntegerOption((o) => o.setName('soldats').setDescription('Combien de soldats envoyer (tous par défaut)').setMinValue(1)),
    )
    .setDMPermission(false),

  async autocomplete(interaction) {
    await interaction.respond(teamChoices(interaction.guild.id, interaction.options.getFocused()));
  },

  async execute(interaction) {
    return TEAM_ACTIONS[interaction.options.getSubcommand()](interaction);
  },
};
