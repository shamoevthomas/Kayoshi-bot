import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getQuiz, setQuiz, getQotd, setQotd } from '../../lib/store.js';
import { postQuiz, postWhoSaid } from '../../lib/quiz.js';
import { postQotd } from '../../lib/qotd.js';
import { formatMoney } from '../../lib/shop.js';

// Réglages du quiz de culture générale (voir lib/quiz.js), et de la question du jour (lib/qotd.js).
// Classement du quiz : /top → Quiz.
export default {
  data: new SlashCommandBuilder()
    .setName('quiz')
    .setDescription('Quiz dans un salon : chaque membre qui trouve la bonne réponse gagne de l’argent et des coins.')
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
    .addSubcommand((s) => s.setName('qui-a-dit').setDescription('« Qui a dit ? » : un vieux message du serveur, à deviner qui l’a écrit (dans ce salon).'))
    .addSubcommandGroup((g) =>
      g
        .setName('question-du-jour')
        .setDescription('Une question ouverte chaque jour, avec un fil pour les réponses.')
        .addSubcommand((s) =>
          s
            .setName('activer')
            .setDescription('Envoyer une question chaque jour dans un salon.')
            .addChannelOption((o) => o.setName('salon').setDescription('Le salon de la question du jour').setRequired(true).addChannelTypes(ChannelType.GuildText))
            .addRoleOption((o) => o.setName('role').setDescription('Rôle à mentionner à chaque question (vide : aucune mention)'))
            .addIntegerOption((o) => o.setName('heure').setDescription('Heure d’envoi, heure de Paris (défaut : 18)').setMinValue(0).setMaxValue(23)),
        )
        .addSubcommand((s) => s.setName('desactiver').setDescription('Arrêter la question du jour.'))
        .addSubcommand((s) => s.setName('envoyer').setDescription('Envoyer la question du jour tout de suite (elle compte pour aujourd’hui).')),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    if (interaction.options.getSubcommandGroup(false) === 'question-du-jour') return questionOfTheDay(interaction, sub);
    const cfg = getQuiz(guildId);

    if (sub === 'desactiver') {
      if (!cfg?.enabled) return interaction.reply({ content: 'ℹ️ Le quiz n’était pas activé.', ephemeral: true });
      setQuiz(guildId, { ...cfg, enabled: false });
      return interaction.reply({ content: '✅ Quiz désactivé (le classement est gardé).', ephemeral: true });
    }
    if (sub === 'qui-a-dit') {
      await interaction.deferReply({ ephemeral: true });
      const result = await postWhoSaid(interaction.guild, interaction.channel);
      return interaction.editReply(typeof result === 'string' ? `❌ ${result}` : `✅ « Qui a dit ? » posé : ${result.url}`);
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

// /quiz question-du-jour activer | desactiver | envoyer (voir lib/qotd.js).
async function questionOfTheDay(interaction, sub) {
  const { guild } = interaction;
  const cfg = getQotd(guild.id);
  if (sub === 'desactiver') {
    if (!cfg?.enabled) return interaction.reply({ content: 'ℹ️ La question du jour n’était pas activée.', ephemeral: true });
    setQotd(guild.id, { ...cfg, enabled: false });
    return interaction.reply({ content: '✅ Question du jour désactivée.', ephemeral: true });
  }
  if (sub === 'envoyer') {
    if (!cfg?.channelId) return interaction.reply({ content: '❌ La question du jour n’est pas configurée. Lance `/quiz question-du-jour activer`.', ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const message = await postQotd(guild);
    return interaction.editReply(message ? `✅ Question du jour envoyée : ${message.url}` : '❌ Je n’ai pas pu l’envoyer (salon introuvable ou permissions).');
  }

  // activer : rôle vide = aucune mention.
  const channel = interaction.options.getChannel('salon');
  const role = interaction.options.getRole('role');
  const hour = interaction.options.getInteger('heure') ?? cfg?.hour ?? 18;
  setQotd(guild.id, { ...(cfg ?? {}), enabled: true, channelId: channel.id, roleId: role?.id ?? null, hour });
  const perms = guild.members.me?.permissionsIn(channel);
  const warnings = [];
  const everyone = role?.id === guild.id;
  if (role && (everyone || !role.mentionable) && !perms?.has(PermissionFlagsBits.MentionEveryone)) {
    warnings.push('il me manque la permission « Mentionner @everyone, @here et tous les rôles » : la mention ne notifiera personne');
  }
  if (!perms?.has(PermissionFlagsBits.CreatePublicThreads)) warnings.push('il me manque la permission « Créer des fils publics » : pas de fil pour les réponses');
  return interaction.reply({
    content:
      `✅ Question du jour activée dans ${channel} : chaque jour à **${hour} h** (heure de Paris), avec un fil pour les réponses.` +
      (role ? `\n🔔 Chaque question mentionne ${everyone ? '@everyone' : role}.` : '') +
      (warnings.length ? `\n⚠️ Attention : ${warnings.join(' ; ')}.` : '') +
      '\n-# `/quiz question-du-jour envoyer` pour l’envoyer tout de suite.',
    ephemeral: true,
  });
}
