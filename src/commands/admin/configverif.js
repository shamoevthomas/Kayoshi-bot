import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ChannelType,
  ComponentType,
  EmbedBuilder,
} from 'discord.js';
import { setVerifConfig } from '../../lib/store.js';

const P = PermissionFlagsBits;

const ATTEMPT_OPTIONS = [
  { label: '1 essai', value: '1' },
  { label: '2 essais', value: '2' },
  { label: '3 essais', value: '3' },
  { label: '5 essais', value: '5' },
  { label: '10 essais', value: '10' },
];

const KICK_OPTIONS = [
  { label: 'Pas de kick', value: 'none', description: 'Les membres non vérifiés restent sur le serveur' },
  { label: 'Après 5 minutes', value: '300000' },
  { label: 'Après 10 minutes', value: '600000' },
  { label: 'Après 30 minutes', value: '1800000' },
  { label: 'Après 1 heure', value: '3600000' },
  { label: 'Après 24 heures', value: '86400000' },
];

function selectRow(customId, placeholder, options) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId(customId).setPlaceholder(placeholder).addOptions(options),
  );
}

export default {
  data: new SlashCommandBuilder()
    .setName('configverif')
    .setDescription('Configurer la vérification anti-bot (captcha).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const guild = interaction.guild;
    const filter = (i) => i.user.id === interaction.user.id;
    const config = { channelId: null, roleId: null, maxAttempts: 3, kickAfterMs: null };

    const rolePrompt = '\n\n**2/4 — Rôle après validation**\nQuel rôle donner au membre une fois le captcha réussi ?';
    const roleRow = new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId('cfgv_role').setPlaceholder('Choisis le rôle de membre vérifié').setMinValues(1).setMaxValues(1),
    );

    const step1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cfgv_create').setLabel('Créer un salon').setStyle(ButtonStyle.Success).setEmoji('➕'),
      new ButtonBuilder().setCustomId('cfgv_existing').setLabel('Salon existant').setStyle(ButtonStyle.Primary).setEmoji('📁'),
    );
    const msg = await interaction.reply({
      content: '**1/4 — Salon de vérification**\nOù les membres passeront-ils le captcha ?',
      components: [step1],
      ephemeral: true,
      fetchReply: true,
    });

    try {
      // ===== 1/4 — Salon =====
      const b1 = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 300_000, filter });
      if (b1.customId === 'cfgv_create') {
        const ch = await guild.channels.create({ name: 'vérification', type: ChannelType.GuildText });
        config.channelId = ch.id;
        await b1.update({ content: `✅ Salon créé : <#${ch.id}>${rolePrompt}`, components: [roleRow] });
      } else {
        await b1.update({
          content: 'Choisis le salon de vérification :',
          components: [
            new ActionRowBuilder().addComponents(
              new ChannelSelectMenuBuilder().setCustomId('cfgv_chan').setPlaceholder('Choisis un salon').addChannelTypes(ChannelType.GuildText),
            ),
          ],
        });
        const s = await msg.awaitMessageComponent({ componentType: ComponentType.ChannelSelect, time: 300_000, filter });
        config.channelId = s.values[0];
        await s.update({ content: `✅ Salon : <#${config.channelId}>${rolePrompt}`, components: [roleRow] });
      }

      // ===== 2/4 — Rôle =====
      const roleSel = await msg.awaitMessageComponent({ componentType: ComponentType.RoleSelect, time: 300_000, filter });
      config.roleId = roleSel.values[0];
      await roleSel.update({
        content: `✅ Rôle : <@&${config.roleId}>\n\n**3/4 — Nombre d’essais maximum**`,
        components: [selectRow('cfgv_attempts', 'Combien d’essais autorisés ?', ATTEMPT_OPTIONS)],
      });

      // ===== 3/4 — Essais max =====
      const attSel = await msg.awaitMessageComponent({ componentType: ComponentType.StringSelect, time: 300_000, filter });
      config.maxAttempts = Number(attSel.values[0]);
      await attSel.update({
        content: `✅ ${config.maxAttempts} essai(s) max\n\n**4/4 — Kick des non-vérifiés**\nAu bout de combien de temps expulser un membre qui n’a pas validé ?`,
        components: [selectRow('cfgv_kick', 'Délai avant kick', KICK_OPTIONS)],
      });

      // ===== 4/4 — Délai de kick =====
      const kickSel = await msg.awaitMessageComponent({ componentType: ComponentType.StringSelect, time: 300_000, filter });
      config.kickAfterMs = kickSel.values[0] === 'none' ? null : Number(kickSel.values[0]);

      // Sauvegarde + message d'info dans le salon
      setVerifConfig(guild.id, config);
      const channel = guild.channels.cache.get(config.channelId) ?? (await guild.channels.fetch(config.channelId));
      await channel
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle('🛡️ Vérification requise')
              .setDescription(
                'Bienvenue ! Pour accéder au serveur, un **captcha** va apparaître à ton arrivée.\n' +
                  'Recopie le texte de l’image dans ce salon.\n\n' +
                  '_Si aucun captcha n’apparaît, envoie un message ici pour en recevoir un._',
              ),
          ],
        })
        .catch(() => {});

      const kickText =
        config.kickAfterMs == null
          ? 'aucun kick'
          : `kick après ${KICK_OPTIONS.find((o) => o.value === String(config.kickAfterMs))?.label.replace('Après ', '')}`;

      await kickSel.update({
        content:
          `✅ **Vérification configurée !**\n` +
          `• Salon : <#${config.channelId}>\n` +
          `• Rôle après validation : <@&${config.roleId}>\n` +
          `• Essais max : ${config.maxAttempts}\n` +
          `• Délai : ${kickText}`,
        components: [],
        embeds: [],
      });
    } catch (err) {
      console.error(err);
      return interaction.editReply({ content: '⏱️ Configuration annulée (délai dépassé ou erreur). Relance `/configverif`.', components: [], embeds: [] }).catch(() => {});
    }
  },
};
