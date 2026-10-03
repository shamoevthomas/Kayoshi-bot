import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  RoleSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
} from 'discord.js';
import { getBumpReminder, patchBumpReminder } from '../../lib/store.js';
import { BUMP_TEMPLATE_HELP, reminderText, thanksText, roleMention } from '../../lib/bumpreminder.js';
import { Colors } from '../../lib/logger.js';

const quote = (text) => `> ${text.replaceAll('\n', '\n> ')}`.slice(0, 1024);

// Panneau principal : réglages actuels + les 3 boutons de modification.
function panel(guild, note = null, active = true) {
  const cfg = getBumpReminder(guild.id);
  const thanks = thanksText(cfg);
  const embed = new EmbedBuilder()
    .setColor(Colors.role)
    .setTitle('⏰ Rappel de bump Disboard')
    .setDescription(
      `Statut : **${cfg.enabled ? 'activé' : 'désactivé'}** (\`/bremind\` pour changer)\n` +
        (cfg.enabled && cfg.nextAt ? `Prochain rappel : <t:${Math.floor(cfg.nextAt / 1000)}:R>\n` : '') +
        `\n${BUMP_TEMPLATE_HELP}`,
    )
    .addFields(
      { name: '🔔 Rôle à mentionner', value: cfg.roleId ? roleMention(guild.id, cfg.roleId).text.trim() : 'Aucun' },
      { name: '✏️ Message de rappel (2 h après le bump)', value: quote(reminderText(cfg)) },
      { name: '💬 Message après avoir bump', value: thanks ? quote(thanks) : 'Aucun' },
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('brm_reminder').setLabel('Modifier le message de rappel').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
    new ButtonBuilder().setCustomId('brm_role').setLabel('Rôle à mentionner').setStyle(ButtonStyle.Primary).setEmoji('🔔'),
    new ButtonBuilder().setCustomId('brm_thanks').setLabel('Message après avoir bump').setStyle(ButtonStyle.Primary).setEmoji('💬'),
  );
  return { content: note ?? '', embeds: [embed], components: active ? [row] : [] };
}

function roleView(guild) {
  const select = new RoleSelectMenuBuilder().setCustomId('brm_roleselect').setPlaceholder('Choisis un rôle').setMinValues(1).setMaxValues(1);
  const { roleId } = getBumpReminder(guild.id);
  if (roleId) select.setDefaultRoles(roleId);
  return {
    content: '🔔 Quel rôle mentionner dans le rappel ?',
    embeds: [],
    components: [
      new ActionRowBuilder().addComponents(select),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('brm_rolenone').setLabel('Aucun rôle').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('brm_back').setLabel('Retour').setStyle(ButtonStyle.Secondary).setEmoji('↩️'),
      ),
    ],
  };
}

// Sans la permission « Mentionner @everyone, @here et tous les rôles », un rôle
// non mentionnable (ou @everyone) s'affiche dans le rappel mais ne ping personne.
function mentionWarning(guild, role) {
  const silent = role.id === guild.id || !role.mentionable;
  if (!silent || guild.members.me?.permissions.has(PermissionFlagsBits.MentionEveryone)) return '';
  return '\n⚠️ Ce rôle ne sera pas notifié : rends-le mentionnable, ou donne-moi la permission « Mentionner @everyone, @here et tous les rôles ».';
}

// Formulaire d'un des deux messages. L'ID du formulaire est unique à chaque
// ouverture : un formulaire fermé puis rouvert ne valide pas deux fois.
async function editMessage(i, kind, isActive) {
  const isReminder = kind === 'reminder';
  const cfg = getBumpReminder(i.guild.id);
  const current = isReminder ? reminderText(cfg) : thanksText(cfg);
  const modalId = `brm_modal_${i.id}`;

  const input = new TextInputBuilder()
    .setCustomId('message')
    .setLabel(isReminder ? 'Message de rappel' : 'Message (vide = aucun message)')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(isReminder)
    .setMaxLength(1500);
  if (current) input.setValue(current);
  await i.showModal(
    new ModalBuilder()
      .setCustomId(modalId)
      .setTitle(isReminder ? 'Message de rappel' : 'Message après avoir bump')
      .addComponents(new ActionRowBuilder().addComponents(input)),
  );

  const sub = await i.awaitModalSubmit({ time: 600_000, filter: (s) => s.customId === modalId }).catch(() => null);
  if (!sub) return;
  const value = sub.fields.getTextInputValue('message').trim();

  if (isReminder) {
    if (!value) return sub.update(panel(i.guild, '❌ Le message de rappel ne peut pas être vide.', isActive()));
    patchBumpReminder(i.guild.id, { reminderMessage: value });
    return sub.update(panel(i.guild, '✅ Message de rappel enregistré.', isActive()));
  }
  // Chaîne vide conservée : plus aucun message après le bump.
  patchBumpReminder(i.guild.id, { thanksMessage: value });
  return sub.update(panel(i.guild, value ? '✅ Message après bump enregistré.' : '🚫 Plus de message après le bump.', isActive()));
}

export default {
  data: new SlashCommandBuilder()
    .setName('bremind-edit')
    .setDescription('Modifier le rappel de bump : message de rappel, rôle mentionné, message après bump.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const { guild } = interaction;
    const msg = await interaction.reply({ ...panel(guild), ephemeral: true, fetchReply: true });

    const collector = msg.createMessageComponentCollector({ idle: 600_000, filter: (i) => i.user.id === interaction.user.id });
    const isActive = () => !collector.ended;

    collector.on('collect', async (i) => {
      try {
        if (i.customId === 'brm_reminder') return await editMessage(i, 'reminder', isActive);
        if (i.customId === 'brm_thanks') return await editMessage(i, 'thanks', isActive);
        if (i.customId === 'brm_role') return await i.update(roleView(guild));
        if (i.customId === 'brm_back') return await i.update(panel(guild));
        if (i.customId === 'brm_rolenone') {
          patchBumpReminder(guild.id, { roleId: null });
          return await i.update(panel(guild, '🚫 Le rappel ne mentionnera plus aucun rôle.'));
        }
        if (i.customId === 'brm_roleselect') {
          const role = i.roles.first();
          patchBumpReminder(guild.id, { roleId: role.id });
          return await i.update(panel(guild, `✅ Rôle à mentionner : ${roleMention(guild.id, role.id).text.trim()}${mentionWarning(guild, role)}`));
        }
      } catch (err) {
        console.error('[bremind-edit] échec :', err);
      }
    });

    collector.on('end', () => interaction.editReply({ components: [] }).catch(() => {}));
  },
};
