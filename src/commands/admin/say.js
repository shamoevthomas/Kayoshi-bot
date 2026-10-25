import { SlashCommandBuilder, PermissionFlagsBits, ApplicationIntegrationType, InteractionContextType } from 'discord.js';

// Aussi utilisable en application externe (bot installé sur son compte) : serveurs sans le bot,
// MP et groupes. Commande globale (voir deploy-commands.js). La permission Gérer les messages est
// vérifiée ici sur les serveurs du bot plutôt que par Discord, qui pourrait sinon masquer la
// commande hors de ces serveurs.

// Hors des serveurs du bot, seules ces personnes peuvent utiliser /say (l'application est publique :
// n'importe qui peut l'installer sur son compte).
const EXTERNAL_USERS = new Set([
  '1079335251551191061', // laysox_off
]);

export default {
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Faire parler le bot dans ce salon.')
    .addStringOption((o) => o.setName('message').setDescription('Le message à envoyer').setRequired(true).setMaxLength(2000))
    .setIntegrationTypes(ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall)
    .setContexts(InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel),

  async execute(interaction) {
    const message = interaction.options.getString('message');
    // Les membres mentionnés sont notifiés ; les rôles, @everyone et @here ne pingent pas.
    const allowedMentions = { parse: ['users'] };

    // Serveur où le bot est présent : message envoyé dans le salon, confirmation visible de soi seul.
    if (interaction.inCachedGuild()) {
      if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageMessages)) {
        return interaction.reply({ content: '❌ Il faut la permission **Gérer les messages** pour utiliser `/say` ici.', ephemeral: true });
      }
      await interaction.channel.send({ content: message, allowedMentions });
      return interaction.reply({ content: '✅ Message envoyé.', ephemeral: true });
    }

    // Application externe (serveur sans le bot, MP, groupe) : le bot ne peut pas écrire de lui-même,
    // le message est donc la réponse à la commande.
    if (!EXTERNAL_USERS.has(interaction.user.id)) {
      return interaction.reply({ content: '❌ Tu n’as pas accès à `/say` en dehors des serveurs du bot.', ephemeral: true });
    }
    await interaction.reply({ content: message, allowedMentions });
  },
};
