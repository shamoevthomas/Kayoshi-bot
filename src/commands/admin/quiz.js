import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getQuiz, setQuiz } from '../../lib/store.js';
import { postQuiz } from '../../lib/quiz.js';
import { formatMoney } from '../../lib/shop.js';

// Réglages du quiz de culture générale (voir lib/quiz.js). Classement : /top → Quiz.
export default {
  data: new SlashCommandBuilder()
    .setName('quiz')
    .setDescription('Quiz de culture générale dans un salon : le premier qui trouve gagne de l’argent.')
    .addSubcommand((s) =>
      s
        .setName('activer')
        .setDescription('Activer le quiz dans un salon.')
        .addChannelOption((o) => o.setName('salon').setDescription('Le salon du quiz').setRequired(true).addChannelTypes(ChannelType.GuildText))
        .addIntegerOption((o) => o.setName('frequence').setDescription('Minutes entre deux questions (défaut : 30)').setMinValue(5).setMaxValue(720))
        .addIntegerOption((o) => o.setName('recompense').setDescription('Argent pour la bonne réponse (défaut : 100)').setMinValue(0))
        .addRoleOption((o) => o.setName('role').setDescription('Rôle à mentionner à chaque question (vide : aucune mention)')),
    )
    .addSubcommand((s) => s.setName('desactiver').setDescription('Arrêter le quiz.'))
    .addSubcommand((s) => s.setName('question').setDescription('Poser une question tout de suite.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    const cfg = getQuiz(guildId);

    if (sub === 'desactiver') {
      if (!cfg?.enabled) return interaction.reply({ content: 'ℹ️ Le quiz n’était pas activé.', ephemeral: true });
      setQuiz(guildId, { ...cfg, enabled: false });
      return interaction.reply({ content: '✅ Quiz désactivé (le classement est gardé).', ephemeral: true });
    }
    if (sub === 'question') {
      if (!cfg?.channelId) return interaction.reply({ content: '❌ Le quiz n’est pas configuré. Lance `/quiz activer`.', ephemeral: true });
      await interaction.deferReply({ ephemeral: true });
      const message = await postQuiz(interaction.guild);
      return interaction.editReply(message ? `✅ Question posée : ${message.url}` : '❌ Je n’ai pas pu poser la question (salon introuvable ou permissions).');
    }

    // activer : fréquence et récompense vides gardent la valeur déjà réglée (ou celle par défaut) ;
    // rôle vide = aucune mention.
    const channel = interaction.options.getChannel('salon');
    const role = interaction.options.getRole('role');
    const next = {
      enabled: true,
      channelId: channel.id,
      everyMin: interaction.options.getInteger('frequence') ?? cfg?.everyMin ?? 30,
      reward: interaction.options.getInteger('recompense') ?? cfg?.reward ?? 100,
      roleId: role?.id ?? null,
    };
    setQuiz(guildId, next);
    // @everyone, ou un rôle non mentionnable, demande la permission « Mentionner @everyone… » au bot.
    const everyone = role?.id === guildId;
    const canPing = !role || (!everyone && role.mentionable) || interaction.guild.members.me?.permissionsIn(channel).has(PermissionFlagsBits.MentionEveryone);
    const mention = role
      ? `\n🔔 Chaque question mentionne ${everyone ? '@everyone' : role}.` +
        (canPing ? '' : ' ⚠️ Il me manque la permission « Mentionner @everyone, @here et tous les rôles » dans ce salon : la mention ne notifiera personne.')
      : '';
    return interaction.reply({
      content:
        `✅ Quiz activé dans ${channel} : une question environ toutes les **${next.everyMin} min** (seulement si le serveur est actif), ` +
        `💰 **${formatMoney(next.reward)}** pour la bonne réponse.${mention}\n-# \`/quiz question\` pour en poser une tout de suite · classement dans \`/top\`.`,
      ephemeral: true,
    });
  },
};
