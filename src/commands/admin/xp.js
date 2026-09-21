import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { getXp, setXp, addXp } from '../../lib/store.js';
import { levelFromXp, xpForLevel, xpDeltaForLevels } from '../../lib/levels.js';
import { sendLog, Colors } from '../../lib/logger.js';

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
    ),

  async execute(interaction) {
    const guildId = interaction.guild.id;
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
