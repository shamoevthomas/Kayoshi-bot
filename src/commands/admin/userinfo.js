import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import {
  getWarns,
  getXp,
  getLevelLeaderboard,
  getMoney,
  getMoneyLeaderboard,
  getCoins,
  getBank,
  getLivret,
  getFortuneLeaderboard,
  getRep,
  getCasinoInv,
  getInviteTotal,
  getQuizScores,
} from '../../lib/store.js';
import { levelInfo } from '../../lib/levels.js';
import { formatMoney } from '../../lib/shop.js';
import { teamOf } from '../../lib/teams.js';
import { familySummary } from '../../lib/family.js';
import { userStats } from '../../lib/stats.js';

// Fiche d'un membre : identité, niveau, argent des niveaux, coins du casino, réputation, team, famille,
// activité des 14 derniers jours, invitations, quiz et avertissements.
const rankText = (list, userId) => {
  const i = list.findIndex((r) => r.userId === userId);
  return i < 0 ? '' : ` · **${place(i + 1)}** du serveur`;
};
const place = (n) => (n === 1 ? '1ᵉʳ' : `${n}ᵉ`);
const voiceText = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
};
const ts = (ms, style) => `<t:${Math.floor(ms / 1000)}:${style}>`;

export default {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Fiche d’un membre : niveau, argent, coins, famille, activité, sanctions…')
    .addUserOption((o) => o.setName('membre').setDescription('Le membre (vide = toi)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const { guild } = interaction;
    const target = interaction.options.getUser('membre') ?? interaction.user;
    const member = await guild.members.fetch(target.id).catch(() => null);
    const id = target.id;

    const roles = member
      ? member.roles.cache.filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position).map((r) => `${r}`).slice(0, 20).join(' ') || 'Aucun'
      : 'Membre absent du serveur';

    // Niveau
    const lvl = levelInfo(getXp(guild.id, id));
    const progress = lvl.span ? Math.floor((lvl.into / lvl.span) * 100) : 0;
    const levels = getLevelLeaderboard(guild.id, 100_000);
    // Coins du casino
    const pocket = getCoins(guild.id, id);
    const bank = getBank(guild.id, id);
    const livret = getLivret(guild.id, id).amount;
    const inv = getCasinoInv(guild.id, id);
    const team = teamOf(guild.id, id);
    // Activité (14 derniers jours)
    const stats = userStats(guild.id, id);
    const warns = getWarns(guild.id, id);

    const embed = new EmbedBuilder()
      .setColor(member?.displayColor || 0x5865f2)
      .setAuthor({ name: target.tag, iconURL: target.displayAvatarURL() })
      .setThumbnail(target.displayAvatarURL({ size: 256 }))
      .addFields(
        {
          name: '🆔 Identité',
          value: [
            `ID : \`${id}\`${target.bot ? ' · 🤖 bot' : ''}`,
            `Compte créé ${ts(target.createdTimestamp, 'D')} (${ts(target.createdTimestamp, 'R')})`,
            member?.joinedTimestamp ? `A rejoint ${ts(member.joinedTimestamp, 'D')} (${ts(member.joinedTimestamp, 'R')})` : 'N’est plus sur le serveur',
          ].join('\n'),
        },
        {
          name: '📈 Niveau',
          value: `Niveau **${lvl.level}** · ${formatMoney(lvl.xp)} XP${rankText(levels, id)}\nProgression : ${progress} % (encore ${formatMoney(lvl.toNext)} XP)`,
          inline: true,
        },
        { name: '💰 Argent (niveaux)', value: `**${formatMoney(getMoney(guild.id, id))}**${rankText(getMoneyLeaderboard(guild.id), id)}`, inline: true },
        {
          name: '🪙 Coins (casino)',
          value:
            `Poche **${formatMoney(pocket)}** · banque **${formatMoney(bank)}** · livret **${formatMoney(livret)}**\n` +
            `Total **${formatMoney(pocket + bank + livret)}**${rankText(getFortuneLeaderboard(guild.id), id)}` +
            (inv.buildings.length ? ` · 🏢 ${inv.buildings.length} bâtiment(s)` : ''),
        },
        {
          name: '⭐ Réputation · 👥 Team',
          value: `⭐ ${getRep(guild.id, id)} · 👥 ${team ? `**${team.name}**${team.ownerId === id ? ' (chef)' : ''}` : 'aucune'}`,
          inline: true,
        },
        { name: '📨 Invitations · 🧠 Quiz', value: `📨 ${getInviteTotal(guild.id, id)} · 🧠 ${getQuizScores(guild.id)[id] ?? 0} bonne(s) réponse(s)`, inline: true },
        {
          name: '📊 Activité (14 derniers jours)',
          value:
            `💬 **${formatMoney(stats.messages.d14)}** message(s)${stats.rank.messages ? ` (${place(stats.rank.messages)})` : ''} · ` +
            `🔊 **${voiceText(stats.voice.d14)}** en vocal${stats.rank.voice ? ` (${place(stats.rank.voice)})` : ''}`,
        },
        { name: '💍 Famille', value: familySummary(guild, id).data.description?.slice(0, 1024) || '💍 Célibataire' },
        { name: '⚠️ Avertissements', value: warns.length ? `**${warns.length}** — détail : \`/casier\`` : 'Aucun', inline: true },
        { name: `🎭 Rôles`, value: roles.slice(0, 1024) },
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
