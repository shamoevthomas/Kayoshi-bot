import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import {
  getXp,
  setXp,
  addXp,
  getLevelRewards,
  getLevelRewardModes,
  getLevelMoneyRewards,
  setLevelReward,
  setLevelMoneyReward,
  removeLevelReward,
} from '../../lib/store.js';
import { formatMoney } from '../../lib/shop.js';
import { levelFromXp, xpForLevel, xpDeltaForLevels, syncLevelRoles, LEVEL_COLOR, MONEY_PER_LEVEL } from '../../lib/levels.js';
import { sendLog, Colors } from '../../lib/logger.js';

// Refuse un rôle que le bot ne pourra pas attribuer.
function roleProblem(guild, role) {
  if (role.id === guild.id) return 'C’est le rôle @everyone.';
  if (role.managed) return 'Ce rôle est géré par une intégration et ne peut pas être attribué.';
  const me = guild.members.me;
  if (me && role.position >= me.roles.highest.position) {
    return 'Ce rôle est au-dessus du mien — descends-le sous mon rôle le plus haut.';
  }
  return null;
}

const UNIT_CHOICES = [
  { name: 'XP', value: 'xp' },
  { name: 'Niveaux', value: 'niveaux' },
];

function unitOption(o) {
  return o
    .setName('unite')
    .setDescription('XP (par défaut) ou niveaux')
    .setRequired(false)
    .addChoices(...UNIT_CHOICES);
}
function reasonOption(o) {
  return o.setName('raison').setDescription('Raison (optionnelle)').setRequired(false);
}
function amountOption(o) {
  return o.setName('montant').setDescription('Quantité (nombre positif)').setRequired(true).setMinValue(1);
}
function setAmountOption(o) {
  return o.setName('montant').setDescription('Valeur cible (0 ou plus)').setRequired(true).setMinValue(0);
}

export default {
  data: new SlashCommandBuilder()
    .setName('xp')
    .setDescription('Gérer l’XP et les niveaux des membres.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('ajouter')
        .setDescription('Ajouter de l’XP (ou des niveaux) à un membre.')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
        .addIntegerOption(amountOption)
        .addStringOption(unitOption)
        .addStringOption(reasonOption),
    )
    .addSubcommand((s) =>
      s
        .setName('retirer')
        .setDescription('Retirer de l’XP (ou des niveaux) à un membre.')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
        .addIntegerOption(amountOption)
        .addStringOption(unitOption)
        .addStringOption(reasonOption),
    )
    .addSubcommand((s) =>
      s
        .setName('definir')
        .setDescription('Fixer l’XP (ou le niveau) d’un membre à une valeur précise.')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
        .addIntegerOption(setAmountOption)
        .addStringOption(unitOption)
        .addStringOption(reasonOption),
    )
    .addSubcommandGroup((g) =>
      g
        .setName('recompense')
        .setDescription('Rôles attribués automatiquement à partir d’un niveau.')
        .addSubcommand((s) =>
          s
            .setName('ajouter')
            .setDescription('Attribuer un rôle à partir d’un niveau.')
            .addIntegerOption((o) => o.setName('niveau').setDescription('Niveau requis (0 = dès l’arrivée)').setRequired(true).setMinValue(0))
            .addRoleOption((o) => o.setName('role').setDescription('Rôle à donner (facultatif si tu donnes de l’argent)'))
            .addStringOption((o) =>
              o
                .setName('mode')
                .setDescription('Pour le rôle. Addition (par défaut) : gardé. Évolutif : remplacé au palier évolutif suivant.')
                .addChoices({ name: 'Addition', value: 'addition' }, { name: 'Évolutif', value: 'evolutif' }),
            )
            .addIntegerOption((o) =>
              o.setName('argent').setDescription('Argent donné en passant ce niveau (à la place ou en plus du rôle)').setMinValue(1),
            ),
        )
        .addSubcommand((s) =>
          s
            .setName('retirer')
            .setDescription('Supprimer la récompense d’un niveau.')
            .addIntegerOption((o) => o.setName('niveau').setDescription('Niveau concerné').setRequired(true).setMinValue(0)),
        )
        .addSubcommand((s) => s.setName('liste').setDescription('Voir les rôles-récompenses configurés.')),
    ),

  async execute(interaction) {
    const guildId = interaction.guild.id;

    // --- Sous-groupe : gestion des rôles-récompenses ---
    if (interaction.options.getSubcommandGroup(false) === 'recompense') {
      return handleRewards(interaction, guildId);
    }

    const sub = interaction.options.getSubcommand();
    const target = interaction.options.getUser('membre');
    const amount = interaction.options.getInteger('montant');
    const unit = interaction.options.getString('unite') ?? 'xp';
    const reason = interaction.options.getString('raison') || 'Aucune raison précisée';

    if (target.bot) {
      return interaction.reply({ content: '❌ On ne gère pas l’XP d’un bot.', ephemeral: true });
    }

    const before = getXp(guildId, target.id);
    let after;

    if (sub === 'definir') {
      after = setXp(guildId, target.id, unit === 'niveaux' ? xpForLevel(amount) : amount);
    } else {
      const sign = sub === 'retirer' ? -1 : 1;
      const delta =
        unit === 'niveaux' ? xpDeltaForLevels(before, sign * amount) : sign * amount;
      ({ after } = addXp(guildId, target.id, delta));
    }

    const oldLevel = levelFromXp(before);
    const newLevel = levelFromXp(after);
    const verb = sub === 'ajouter' ? 'Ajout' : sub === 'retirer' ? 'Retrait' : 'Définition';
    const unitLabel = unit === 'niveaux' ? `niveau(x)` : 'XP';

    // Aligne les rôles-récompenses sur le nouveau niveau.
    if (newLevel !== oldLevel) {
      const member = await interaction.guild.members.fetch(target.id).catch(() => null);
      if (member) await syncLevelRoles(member, newLevel).catch(() => {});
    }

    // Confirmation (éphémère) pour le modérateur.
    await interaction.reply({
      content:
        `✅ **${verb}** de **${amount} ${unitLabel}** pour ${target}.\n` +
        `XP : **${before}** → **${after}** · Niveau : **${oldLevel}** → **${newLevel}**\n` +
        `Raison : ${reason}`,
      ephemeral: true,
    });

    // Log public.
    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(newLevel >= oldLevel ? Colors.join : Colors.leave)
        .setAuthor({ name: '🎚️ XP / Niveau modifié', iconURL: target.displayAvatarURL() })
        .setDescription(`${target} (${target.tag})`)
        .addFields(
          { name: 'Opération', value: `${verb} de ${amount} ${unitLabel}`, inline: true },
          { name: 'XP', value: `${before} → ${after}`, inline: true },
          { name: 'Niveau', value: `${oldLevel} → ${newLevel}`, inline: true },
          { name: 'Raison', value: reason },
          { name: 'Par', value: `${interaction.user}`, inline: true },
        )
        .setTimestamp(),
    );
  },
};

// Gestion du sous-groupe /xp recompense (ajouter / retirer / liste).
async function handleRewards(interaction, guildId) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'ajouter') {
    const level = interaction.options.getInteger('niveau');
    const role = interaction.options.getRole('role');
    const mode = interaction.options.getString('mode') ?? 'addition';
    const money = interaction.options.getInteger('argent');
    if (!role && !money) {
      return interaction.reply({ content: '❌ Choisis au moins un rôle (`role`) ou une somme d’argent (`argent`) à donner.', ephemeral: true });
    }
    // L'argent est versé au passage d'un niveau : le niveau 0 (celui de départ) ne se passe jamais.
    if (money && level === 0) {
      return interaction.reply({ content: '❌ L’argent est donné en passant un niveau : choisis un niveau à partir de 1.', ephemeral: true });
    }
    const problem = role && roleProblem(interaction.guild, role);
    if (problem) return interaction.reply({ content: `❌ ${problem}`, ephemeral: true });

    const lines = [];
    if (role) {
      setLevelReward(guildId, level, role.id, mode);
      const how =
        mode === 'evolutif'
          ? '**Évolutif** : il sera remplacé par le rôle du palier évolutif suivant.'
          : '**Addition** : ils le gardent aux niveaux suivants.';
      lines.push(`✅ À partir du **niveau ${level}**, les membres reçoivent ${role}. ${how}`);
    }
    if (money) {
      setLevelMoneyReward(guildId, level, money);
      lines.push(`✅ En passant le **niveau ${level}**, les membres reçoivent 💰 **${formatMoney(money)}** (en plus des ${formatMoney(MONEY_PER_LEVEL)} habituels).`);
    }
    if (role) {
      lines.push('_(rôle appliqué automatiquement à l’arrivée des membres et à chaque message qui leur rapporte de l’XP : les membres déjà à ce niveau l’obtiendront à leur prochain message)_');
    }
    return interaction.reply({ content: lines.join('\n'), ephemeral: true });
  }

  if (sub === 'retirer') {
    const level = interaction.options.getInteger('niveau');
    const removed = removeLevelReward(guildId, level);
    return interaction.reply({
      content: removed
        ? `✅ Récompenses du **niveau ${level}** supprimées (rôle et argent). _(les membres gardent ce qu’ils ont déjà obtenu)_`
        : `ℹ️ Aucune récompense n’était configurée pour le niveau ${level}.`,
      ephemeral: true,
    });
  }

  // liste
  const rewards = getLevelRewards(guildId);
  const modes = getLevelRewardModes(guildId);
  const money = getLevelMoneyRewards(guildId);
  const levels = [...new Set([...Object.keys(rewards), ...Object.keys(money)])].sort((a, b) => Number(a) - Number(b));
  const describe = (lvl) =>
    [
      rewards[lvl] && `<@&${rewards[lvl]}> · ${modes[lvl] === 'evolutif' ? 'évolutif' : 'addition'}`,
      money[lvl] && `💰 ${formatMoney(money[lvl])}`,
    ]
      .filter(Boolean)
      .join(' · ');
  const embed = new EmbedBuilder()
    .setColor(LEVEL_COLOR)
    .setTitle('🏅 Récompenses par niveau')
    .setDescription(
      levels.length
        ? levels.map((lvl) => `**Niveau ${lvl}** → ${describe(lvl)}`).join('\n')
        : '_Aucune récompense configurée._ Utilise `/xp recompense ajouter`.',
    );
  return interaction.reply({ embeds: [embed], ephemeral: true });
}
