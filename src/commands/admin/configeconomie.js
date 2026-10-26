import { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } from 'discord.js';
import { getMoneyDrops, setMoneyDrops, getWeeklyTop, setWeeklyTop } from '../../lib/store.js';
import { formatMoney } from '../../lib/shop.js';
import { lastFinishedWeek } from '../../lib/weeklytop.js';

// Économie automatique : drops d'argent dans les salons actifs, membres de la semaine.
// Les options non remplies gardent la valeur déjà réglée (ou la valeur par défaut).
const DROP_DEFAULTS = { min: 50, max: 200, everyMin: 60 };
const WEEK_DEFAULTS = { m1: 500, m2: 300, m3: 150, v1: 500, v2: 300, v3: 150 };
const PLACES = [
  ['m1', 'top1_messages', 'Top 1 des messages'],
  ['m2', 'top2_messages', 'Top 2 des messages'],
  ['m3', 'top3_messages', 'Top 3 des messages'],
  ['v1', 'top1_vocal', 'Top 1 du vocal'],
  ['v2', 'top2_vocal', 'Top 2 du vocal'],
  ['v3', 'top3_vocal', 'Top 3 du vocal'],
];

export default {
  data: new SlashCommandBuilder()
    .setName('configeconomie')
    .setDescription('Drops d’argent dans les salons et récompenses des membres de la semaine.')
    .addSubcommand((s) =>
      s
        .setName('drops')
        .setDescription('Argent à ramasser de temps en temps dans les salons choisis (le premier qui clique gagne).')
        .addBooleanOption((o) => o.setName('actif').setDescription('Activer ou désactiver les drops').setRequired(true))
        .addChannelOption((o) => o.setName('salon_1').setDescription('Salon où l’argent peut tomber').addChannelTypes(ChannelType.GuildText))
        .addChannelOption((o) => o.setName('salon_2').setDescription('Autre salon (facultatif)').addChannelTypes(ChannelType.GuildText))
        .addChannelOption((o) => o.setName('salon_3').setDescription('Autre salon (facultatif)').addChannelTypes(ChannelType.GuildText))
        .addIntegerOption((o) => o.setName('montant_min').setDescription('Montant minimum d’un drop (défaut : 50)').setMinValue(1))
        .addIntegerOption((o) => o.setName('montant_max').setDescription('Montant maximum d’un drop (défaut : 200)').setMinValue(1))
        .addIntegerOption((o) =>
          o.setName('frequence').setDescription('Minutes entre deux drops, environ (défaut : 60)').setMinValue(5).setMaxValue(1440),
        ),
    )
    .addSubcommand((s) => {
      s.setName('semaine')
        .setDescription('Chaque lundi : argent pour le top 3 messages et le top 3 vocal de la semaine.')
        .addBooleanOption((o) => o.setName('actif').setDescription('Activer ou désactiver les membres de la semaine').setRequired(true))
        .addChannelOption((o) => o.setName('salon').setDescription('Salon de l’annonce du lundi').addChannelTypes(ChannelType.GuildText));
      for (const [, option, label] of PLACES) {
        s.addIntegerOption((o) => o.setName(option).setDescription(`Argent pour le ${label.toLowerCase()} (0 = rien)`).setMinValue(0));
      }
      return s.addRoleOption((o) => o.setName('role').setDescription('(Facultatif) rôle donné au top 1 messages et au top 1 vocal pour la semaine'));
    })
    .addSubcommand((s) => s.setName('voir').setDescription('Voir les réglages actuels.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'drops') return configureDrops(interaction);
    if (sub === 'semaine') return configureWeek(interaction);
    return interaction.reply({ embeds: [overview(interaction.guild.id)], ephemeral: true });
  },
};

async function configureDrops(interaction) {
  const guildId = interaction.guild.id;
  const o = interaction.options;
  const prev = { ...DROP_DEFAULTS, channelIds: [], ...getMoneyDrops(guildId) };
  const picked = ['salon_1', 'salon_2', 'salon_3'].map((n) => o.getChannel(n)?.id).filter(Boolean);
  const cfg = {
    enabled: o.getBoolean('actif'),
    channelIds: picked.length ? [...new Set(picked)] : prev.channelIds,
    min: o.getInteger('montant_min') ?? prev.min,
    max: o.getInteger('montant_max') ?? prev.max,
    everyMin: o.getInteger('frequence') ?? prev.everyMin,
  };
  if (cfg.min > cfg.max) return interaction.reply({ content: '❌ Le montant minimum est plus grand que le maximum.', ephemeral: true });
  if (cfg.enabled && !cfg.channelIds.length) {
    return interaction.reply({ content: '❌ Choisis au moins un salon (`salon_1`) où l’argent peut tomber.', ephemeral: true });
  }
  setMoneyDrops(guildId, cfg);
  return interaction.reply({ content: '✅ Drops d’argent enregistrés.', embeds: [overview(guildId)], ephemeral: true });
}

async function configureWeek(interaction) {
  const guildId = interaction.guild.id;
  const o = interaction.options;
  const prev = getWeeklyTop(guildId) ?? {};
  const rewards = { ...WEEK_DEFAULTS, ...prev.rewards };
  for (const [key, option] of PLACES) rewards[key] = o.getInteger(option) ?? rewards[key];
  const enabled = o.getBoolean('actif');
  const cfg = {
    enabled,
    channelId: o.getChannel('salon')?.id ?? prev.channelId ?? null,
    roleId: o.getRole('role')?.id ?? prev.roleId ?? null,
    rewards,
    // À l'activation, la semaine déjà finie est considérée comme faite : première annonce lundi prochain.
    lastWeek: enabled && !prev.enabled ? lastFinishedWeek() : prev.lastWeek ?? lastFinishedWeek(),
  };
  if (enabled && !cfg.channelId) return interaction.reply({ content: '❌ Choisis le `salon` de l’annonce du lundi.', ephemeral: true });
  const role = cfg.roleId && interaction.guild.roles.cache.get(cfg.roleId);
  if (role && (role.managed || role.position >= interaction.guild.members.me.roles.highest.position)) {
    return interaction.reply({ content: `❌ Je ne peux pas donner le rôle ${role} (rôle d’intégration ou au-dessus du mien).`, ephemeral: true });
  }
  setWeeklyTop(guildId, cfg);
  return interaction.reply({ content: '✅ Membres de la semaine enregistrés.', embeds: [overview(guildId)], ephemeral: true });
}

function overview(guildId) {
  const drops = getMoneyDrops(guildId);
  const week = getWeeklyTop(guildId);
  const money = (n) => (n ? `💰 ${formatMoney(n)}` : 'rien');
  return new EmbedBuilder()
    .setColor(0xf5c542)
    .setTitle('💰 Économie automatique')
    .addFields(
      {
        name: `Drops d’argent — ${drops?.enabled ? '✅ activés' : '❌ désactivés'}`,
        value: drops
          ? `Salons : ${drops.channelIds.map((id) => `<#${id}>`).join(' ') || 'aucun'}\n` +
            `Montant : ${formatMoney(drops.min)} à ${formatMoney(drops.max)} 💰 · environ toutes les ${drops.everyMin} min`
          : '_Pas encore configuré._ `/configeconomie drops`',
      },
      {
        name: `Membres de la semaine — ${week?.enabled ? '✅ activés' : '❌ désactivés'}`,
        value: week
          ? `Annonce le lundi dans ${week.channelId ? `<#${week.channelId}>` : '—'}${week.roleId ? ` · rôle <@&${week.roleId}>` : ''}\n` +
            `💬 Messages : 🥇 ${money(week.rewards.m1)} · 🥈 ${money(week.rewards.m2)} · 🥉 ${money(week.rewards.m3)}\n` +
            `🔊 Vocal : 🥇 ${money(week.rewards.v1)} · 🥈 ${money(week.rewards.v2)} · 🥉 ${money(week.rewards.v3)}`
          : '_Pas encore configuré._ `/configeconomie semaine`',
      },
    );
}
