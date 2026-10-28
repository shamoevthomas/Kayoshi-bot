import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { getLevelLeaderboard, getMoneyLeaderboard, getFortuneLeaderboard, getInviteLeaderboard, getQuizScores } from './store.js';
import { levelFromXp } from './levels.js';
import { serverStats } from './stats.js';
import { formatMoney } from './shop.js';

// /top : tous les classements dans un seul message, un onglet (bouton) par classement.
// Les boutons « top:<onglet> » passent par le routeur d'interactionCreate (marchent après un redémarrage).
const MEDALS = ['🥇', '🥈', '🥉'];
const SHOWN = 10;

const voiceText = (seconds) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
};

// Chaque onglet : titre, couleur, et la liste complète triée [{ userId, text }].
export const TABS = {
  niveaux: {
    label: 'Niveaux',
    emoji: '📈',
    color: 0xffffff,
    rows: (g) => getLevelLeaderboard(g, 100_000).map((r) => ({ userId: r.userId, text: `niveau **${levelFromXp(r.xp)}** · ${formatMoney(r.xp)} XP` })),
  },
  argent: {
    label: 'Argent',
    emoji: '💰',
    color: 0x2ecc71,
    note: 'poche + banque',
    rows: (g) =>
      getFortuneLeaderboard(g).map((r) => ({ userId: r.userId, text: `💰 **${formatMoney(r.money)}**${r.bank ? ` _(dont ${formatMoney(r.bank)} en banque)_` : ''}` })),
  },
  poche: {
    label: 'Poche',
    emoji: '👛',
    color: 0xf1c40f,
    note: 'argent qu’on peut voler',
    rows: (g) => getMoneyLeaderboard(g).map((r) => ({ userId: r.userId, text: `👛 **${formatMoney(r.money)}**` })),
  },
  messages: {
    label: 'Messages',
    emoji: '💬',
    color: 0x5865f2,
    note: '14 derniers jours',
    rows: (g) => serverStats(g, 100_000).topMessageMembers.map((r) => ({ userId: r.id, text: `**${formatMoney(r.value)}** message(s)` })),
  },
  vocal: {
    label: 'Vocal',
    emoji: '🔊',
    color: 0xeb459e,
    note: '14 derniers jours',
    rows: (g) => serverStats(g, 100_000).topVoiceMembers.map((r) => ({ userId: r.id, text: `**${voiceText(r.value)}**` })),
  },
  invitations: {
    label: 'Invitations',
    emoji: '📨',
    color: 0xfee75c,
    rows: (g) =>
      getInviteLeaderboard(g)
        .filter((r) => r.total > 0)
        .map((r) => ({ userId: r.userId, text: `**${r.total}** invitation(s)${r.left ? ` _(${r.left} partie(s))_` : ''}` })),
  },
  quiz: {
    label: 'Quiz',
    emoji: '🧠',
    color: 0x9b59b6,
    rows: (g) =>
      Object.entries(getQuizScores(g))
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([userId, n]) => ({ userId, text: `**${n}** bonne(s) réponse(s)` })),
  },
};

function tabButtons(selected) {
  const keys = Object.keys(TABS);
  const button = (key) =>
    new ButtonBuilder()
      .setCustomId(`top:${key}`)
      .setLabel(TABS[key].label)
      .setEmoji(TABS[key].emoji)
      .setStyle(key === selected ? ButtonStyle.Primary : ButtonStyle.Secondary);
  return [new ActionRowBuilder().addComponents(keys.slice(0, 4).map(button)), new ActionRowBuilder().addComponents(keys.slice(4).map(button))];
}

export function topMessage(guild, tab, viewerId) {
  const key = TABS[tab] ? tab : 'niveaux';
  const t = TABS[key];
  const rows = t.rows(guild.id);
  const lines = rows.slice(0, SHOWN).map((r, i) => `${MEDALS[i] ?? `**${i + 1}.**`} <@${r.userId}> — ${r.text}`);
  const place = rows.findIndex((r) => r.userId === viewerId);
  const embed = new EmbedBuilder()
    .setColor(t.color)
    .setTitle(`${t.emoji} Classement — ${t.label}${t.note ? ` (${t.note})` : ''}`)
    .setDescription(lines.length ? lines.join('\n') : '_Personne pour l’instant._')
    .setFooter({ text: place >= 0 ? `Ta place : ${place + 1}ᵉ sur ${rows.length}` : 'Tu n’es pas encore classé ici' })
    .setTimestamp();
  return { embeds: [embed], components: tabButtons(key), allowedMentions: { parse: [] } };
}

// Bouton d'onglet : affiche ce classement à la place (la place indiquée est celle de qui clique).
export async function handleTopInteraction(interaction) {
  await interaction.update(topMessage(interaction.guild, interaction.customId.split(':')[1], interaction.user.id));
}
