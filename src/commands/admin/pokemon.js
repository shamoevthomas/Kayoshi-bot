import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { startPokemonChannel, stopPokemonChannel, NEEDED } from '../../lib/pokemongame.js';

// /pokemon activer : un salon où les Pokémon s'enchaînent (silhouette, le premier qui trouve le nom gagne un point).
// /pokemon desactiver : arrêter. Voir lib/pokemongame.js.
export default {
  data: new SlashCommandBuilder()
    .setName('pokemon')
    .setDescription('Salon « Quel est ce Pokémon ? » : silhouettes sans fin, le premier qui trouve gagne un point.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('activer')
        .setDescription('Lancer le jeu dans un salon.')
        .addChannelOption((o) => o.setName('salon').setDescription('Le salon du jeu').setRequired(true).addChannelTypes(ChannelType.GuildText))
        .addIntegerOption((o) => o.setName('generation').setDescription('Seulement les Pokémon d’une génération (1 à 9)').setMinValue(1).setMaxValue(9)),
    )
    .addSubcommand((s) => s.setName('desactiver').setDescription('Arrêter le jeu.')),

  async execute(interaction) {
    const { guild } = interaction;
    if (interaction.options.getSubcommand() === 'desactiver') {
      const stopped = await stopPokemonChannel(guild);
      return interaction.reply({ content: stopped ? '🛑 Jeu Pokémon arrêté. Les points sont gardés.' : 'ℹ️ Le jeu Pokémon n’est pas actif.', ephemeral: true });
    }
    const channel = interaction.options.getChannel('salon', true);
    const gen = interaction.options.getInteger('generation');
    if (!channel.permissionsFor(guild.members.me)?.has(NEEDED)) {
      return interaction.reply({
        content: `❌ Il me faut, dans ${channel} : voir le salon, envoyer des messages, intégrer des liens, joindre des fichiers et ajouter des réactions.`,
        ephemeral: true,
      });
    }
    await interaction.deferReply({ ephemeral: true });
    const ok = await startPokemonChannel(guild, channel, gen);
    return interaction.editReply(
      ok
        ? `✅ Jeu Pokémon lancé dans ${channel}${gen ? ` (génération ${gen})` : ''} : le premier Pokémon vient d’arriver !\n-# Les messages écrits dans ce salon sont des réponses : ils ne rapportent ni XP ni argent.`
        : `❌ Je n’ai pas pu poster le premier Pokémon dans ${channel} (image indisponible ou permissions) : réessaie.`,
    );
  },
};
