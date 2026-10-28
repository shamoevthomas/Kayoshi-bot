import { SlashCommandBuilder } from 'discord.js';
import { ROULETTE_BETS, playGame, rulesEmbed } from '../../lib/casino.js';

// Casino : on mise l'argent de sa poche (voir lib/casino.js).
const bet = (o) => o.setName('mise').setDescription('Ta mise : un nombre (ex : 500, 2k), « moitié » ou « tout »').setRequired(true);

export default {
  data: new SlashCommandBuilder()
    .setName('casino')
    .setDescription('Casino : blackjack, poker, roulette, machine à sous et pile ou face.')
    .addSubcommand((s) => s.setName('blackjack').setDescription('Blackjack contre le croupier : approche-toi de 21 sans le dépasser.').addStringOption(bet))
    .addSubcommand((s) => s.setName('poker').setDescription('Poker : garde tes meilleures cartes, change les autres, et vise la meilleure main.').addStringOption(bet))
    .addSubcommand((s) =>
      s
        .setName('roulette')
        .setDescription('Roulette : parie sur une couleur, une parité, une moitié, une douzaine ou un numéro.')
        .addStringOption(bet)
        .addStringOption((o) =>
          o
            .setName('pari')
            .setDescription('Sur quoi tu paries')
            .setRequired(true)
            .addChoices(
              ...Object.entries(ROULETTE_BETS).map(([value, b]) => ({
                name: `${b.label.replace(/^(🔴|⚫) /u, '')}${value === 'numero' ? ' précis (option numero)' : ''} — ×${b.pays}`,
                value,
              })),
            ),
        )
        .addIntegerOption((o) => o.setName('numero').setDescription('Le numéro (0 à 36), pour le pari « Numéro précis »').setMinValue(0).setMaxValue(36)),
    )
    .addSubcommand((s) => s.setName('machine-a-sous').setDescription('Machine à sous : 3 rouleaux, jusqu’à ×200 avec 7️⃣ 7️⃣ 7️⃣.').addStringOption(bet))
    .addSubcommand((s) =>
      s
        .setName('pile-ou-face')
        .setDescription('Pile ou face : une chance sur deux de doubler ta mise.')
        .addStringOption(bet)
        .addStringOption((o) =>
          o.setName('choix').setDescription('Pile ou face ?').setRequired(true).addChoices({ name: 'Pile', value: 'pile' }, { name: 'Face', value: 'face' }),
        ),
    )
    .addSubcommand((s) => s.setName('regles').setDescription('Les règles et les gains de chaque jeu.'))
    .setDMPermission(false),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'regles') return interaction.reply({ embeds: [rulesEmbed()], ephemeral: true });
    const raw = interaction.options.getString('mise', true);
    if (sub === 'blackjack') return playGame(interaction, 'bj', raw);
    if (sub === 'poker') return playGame(interaction, 'vp', raw);
    if (sub === 'machine-a-sous') return playGame(interaction, 'sl', raw);
    if (sub === 'pile-ou-face') return playGame(interaction, 'pf', raw, interaction.options.getString('choix', true));
    const pari = interaction.options.getString('pari', true);
    const numero = interaction.options.getInteger('numero');
    if (pari === 'numero') {
      if (numero === null) return interaction.reply({ content: '❌ Choisis le numéro avec l’option `numero` (0 à 36).', ephemeral: true });
      return playGame(interaction, 'rl', raw, `n${numero}`);
    }
    return playGame(interaction, 'rl', raw, pari);
  },
};
