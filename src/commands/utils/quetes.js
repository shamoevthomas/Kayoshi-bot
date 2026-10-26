import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getQuests, setQuests } from '../../lib/store.js';
import { QUEST_TYPES, questLabel, rewardText, questProgress, doneQuests, checkQuests } from '../../lib/quests.js';
import { currentMonday, weekDays } from '../../lib/weeklytop.js';

// /quetes voir : ouvert à tous ; ajouter / retirer : staff (Gérer le serveur), vérifié ici car
// une commande n'a qu'un seul niveau de permission pour toutes ses sous-commandes.
const MAX_QUESTS = 10;
const BAR = 10;

const bar = (value, target) => {
  const filled = Math.min(BAR, Math.floor((value / target) * BAR));
  return '▰'.repeat(filled) + '▱'.repeat(BAR - filled);
};

export default {
  data: new SlashCommandBuilder()
    .setName('quetes')
    .setDescription('Quêtes de la semaine : objectifs à atteindre pour gagner de l’argent et des niveaux.')
    .addSubcommand((s) =>
      s
        .setName('voir')
        .setDescription('Voir les quêtes de la semaine et ta progression.')
        .addUserOption((o) => o.setName('membre').setDescription('(Facultatif) la progression d’un autre membre')),
    )
    .addSubcommand((s) =>
      s
        .setName('ajouter')
        .setDescription('Ajouter une quête (staff).')
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Ce qu’il faut faire dans la semaine')
            .setRequired(true)
            .addChoices(...Object.entries(QUEST_TYPES).map(([value, t]) => ({ name: t.name, value }))),
        )
        .addIntegerOption((o) => o.setName('objectif').setDescription('Nombre à atteindre (messages, minutes, drops ou dailies)').setRequired(true).setMinValue(1))
        .addIntegerOption((o) => o.setName('argent').setDescription('Argent gagné').setMinValue(0))
        .addIntegerOption((o) => o.setName('niveaux').setDescription('Niveaux gagnés').setMinValue(0).setMaxValue(50)),
    )
    .addSubcommand((s) =>
      s
        .setName('retirer')
        .setDescription('Retirer une quête (staff).')
        .addIntegerOption((o) => o.setName('numero').setDescription('Numéro de la quête (voir /quetes voir)').setRequired(true).setMinValue(1)),
    )
    .setDMPermission(false),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'voir') return show(interaction);
    if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: '❌ Réservé au staff (permission **Gérer le serveur**).', ephemeral: true });
    }
    const guildId = interaction.guild.id;
    const quests = getQuests(guildId);

    if (sub === 'retirer') {
      const index = interaction.options.getInteger('numero') - 1;
      if (!quests[index]) return interaction.reply({ content: `❌ Il n’y a pas de quête n°${index + 1}.`, ephemeral: true });
      setQuests(guildId, quests.filter((_, i) => i !== index));
      return interaction.reply({ content: `✅ Quête retirée : **${questLabel(quests[index])}**.`, ephemeral: true });
    }

    // ajouter
    const quest = {
      id: quests.reduce((max, q) => Math.max(max, q.id), 0) + 1,
      type: interaction.options.getString('type'),
      target: interaction.options.getInteger('objectif'),
      money: interaction.options.getInteger('argent') ?? 0,
      levels: interaction.options.getInteger('niveaux') ?? 0,
    };
    if (!quest.money && !quest.levels) {
      return interaction.reply({ content: '❌ Donne une récompense : de l’`argent` et/ou des `niveaux`.', ephemeral: true });
    }
    if (quests.length >= MAX_QUESTS) {
      return interaction.reply({ content: `❌ ${MAX_QUESTS} quêtes maximum : retires-en une d’abord.`, ephemeral: true });
    }
    setQuests(guildId, [...quests, quest]);
    return interaction.reply({ content: `✅ Quête n°${quests.length + 1} ajoutée : **${questLabel(quest)}** → ${rewardText(quest)}.`, ephemeral: true });
  },
};

async function show(interaction) {
  const { guild } = interaction;
  const user = interaction.options.getUser('membre') ?? interaction.user;
  await interaction.deferReply({ ephemeral: true });
  // Sa propre page : paie d'abord ce qui vient d'être terminé (ex. vocal).
  if (user.id === interaction.user.id) {
    await checkQuests({ guild, author: interaction.user, member: interaction.member, channel: interaction.channel });
  }
  const quests = getQuests(guild.id);
  const week = currentMonday();
  const progress = questProgress(guild.id, user.id, week);
  const done = doneQuests(guild.id, user.id, week);
  const lines = quests.map((q, i) => {
    const value = Math.min(progress[q.type], q.target);
    const ok = done.includes(q.id);
    return `**${i + 1}.** ${ok ? '✅' : '⏳'} **${questLabel(q)}** — ${rewardText(q)}\n${bar(value, q.target)} ${value}/${q.target}`;
  });
  const sunday = weekDays(week)[6].split('-').reverse().slice(0, 2).join('/');
  const embed = new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('📜 Quêtes de la semaine')
    .setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
    .setDescription(lines.length ? lines.join('\n\n') : '_Aucune quête cette semaine._ Le staff peut en ajouter avec `/quetes ajouter`.')
    .setFooter({ text: `${done.length}/${quests.length} terminée(s) · progression remise à zéro après le dimanche ${sunday}` });
  return interaction.editReply({ embeds: [embed] });
}
