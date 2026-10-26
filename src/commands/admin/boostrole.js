import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getRoleBoosts, setRoleBoosts } from '../../lib/store.js';

// Rôles boostés : les membres qui ont le rôle gagnent plus d'XP et/ou d'argent en étant actifs
// (messages, vocal, niveaux, daily, drops, quêtes). Plusieurs rôles boostés : le plus fort compte.
// Se cumule avec l'événement XP et le booster acheté. Appliqué dans lib/levels.js (roleBoost).
const fmt = (n) => `×${n.toLocaleString('fr-FR')}`;

function describe(boost) {
  const parts = [];
  if (boost.xp) parts.push(`📈 XP ${fmt(boost.xp)}`);
  if (boost.money) parts.push(`💰 argent ${fmt(boost.money)}`);
  return parts.join(' · ');
}

export default {
  data: new SlashCommandBuilder()
    .setName('boostrole')
    .setDescription('Rôles boostés : gagner plus d’XP et/ou d’argent (ex : VIP ×1,5).')
    .addSubcommand((s) =>
      s
        .setName('ajouter')
        .setDescription('Booster un rôle (ou changer son boost).')
        .addRoleOption((o) => o.setName('role').setDescription('Le rôle').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('type')
            .setDescription('Ce qui est boosté')
            .setRequired(true)
            .addChoices({ name: 'XP et argent', value: 'both' }, { name: 'XP', value: 'xp' }, { name: 'Argent', value: 'money' }),
        )
        .addNumberOption((o) =>
          o.setName('multiplicateur').setDescription('Ex : 1.5 = 50 % de plus (de 1.1 à 5)').setRequired(true).setMinValue(1.1).setMaxValue(5),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('retirer')
        .setDescription('Retirer le boost d’un rôle.')
        .addRoleOption((o) => o.setName('role').setDescription('Le rôle').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('liste').setDescription('Voir les rôles boostés.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    const boosts = getRoleBoosts(guildId);

    if (sub === 'liste') {
      const lines = Object.entries(boosts).map(([roleId, b]) => `<@&${roleId}> — ${describe(b)}`);
      const embed = new EmbedBuilder()
        .setColor(0xf5c542)
        .setTitle('🚀 Rôles boostés')
        .setDescription(lines.length ? lines.join('\n') : '_Aucun rôle boosté._ Utilise `/boostrole ajouter`.')
        .setFooter({ text: 'Plusieurs rôles boostés : le plus fort compte. Se cumule avec l’événement XP et le booster acheté.' });
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const role = interaction.options.getRole('role');
    if (sub === 'retirer') {
      if (!boosts[role.id]) return interaction.reply({ content: `ℹ️ ${role} n’était pas boosté.`, ephemeral: true });
      const { [role.id]: removed, ...rest } = boosts;
      setRoleBoosts(guildId, rest);
      return interaction.reply({ content: `✅ Boost retiré de ${role}.`, ephemeral: true });
    }

    // ajouter : le type choisi remplace l'ancien multiplicateur, l'autre type est gardé.
    const type = interaction.options.getString('type');
    const multiplier = Math.round(interaction.options.getNumber('multiplicateur') * 100) / 100;
    const boost = { ...boosts[role.id] };
    if (type !== 'money') boost.xp = multiplier;
    if (type !== 'xp') boost.money = multiplier;
    setRoleBoosts(guildId, { ...boosts, [role.id]: boost });
    return interaction.reply({ content: `✅ ${role} est boosté : ${describe(boost)}.`, ephemeral: true, allowedMentions: { parse: [] } });
  },
};
