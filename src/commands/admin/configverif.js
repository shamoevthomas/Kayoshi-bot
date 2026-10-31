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
import { setVerifConfig, getVerifSettings } from '../../lib/store.js';
import { countUnverified, forceVerifyAll } from '../../lib/verification.js';

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
    .setDescription('Activer, désactiver ou configurer la vérification anti-bot (captcha).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const guild = interaction.guild;
    const filter = (i) => i.user.id === interaction.user.id;
    const config = { enabled: true, channelId: null, roleId: null, maxAttempts: 3, kickAfterMs: null, successMentionChannelId: null };

    const rolePrompt = '\n\n**2/5 — Rôle après validation**\nQuel rôle donner au membre une fois le captcha réussi ?';
    const roleRow = new ActionRowBuilder().addComponents(
      new RoleSelectMenuBuilder().setCustomId('cfgv_role').setPlaceholder('Choisis le rôle de membre vérifié').setMinValues(1).setMaxValues(1),
    );

    const step1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cfgv_create').setLabel('Créer un salon').setStyle(ButtonStyle.Success).setEmoji('➕'),
      new ButtonBuilder().setCustomId('cfgv_existing').setLabel('Salon existant').setStyle(ButtonStyle.Primary).setEmoji('📁'),
    );

    // ===== 0 — Activer ou désactiver =====
    const current = getVerifSettings(guild.id);
    const enabled = Boolean(current) && current.enabled !== false;
    const status = !current ? '**pas configurée**' : enabled ? '**activée** ✅' : '**désactivée** ⛔';
    const msg = await interaction.reply({
      content: `🛡️ **Vérification anti-bot** — actuellement ${status}${current ? `\n${settingsText(current)}` : ''}\n\nVeux-tu l’**activer** ou la **désactiver** ?`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('cfgv_on').setLabel('Activer').setStyle(ButtonStyle.Success).setEmoji('✅'),
          new ButtonBuilder().setCustomId('cfgv_off').setLabel('Désactiver').setStyle(ButtonStyle.Danger).setEmoji('⛔'),
        ),
      ],
      ephemeral: true,
      fetchReply: true,
      allowedMentions: { parse: [] },
    });

    try {
      const choice = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 300_000, filter });
      if (choice.customId === 'cfgv_off') return await disable(interaction, choice, msg, filter, current, enabled);

      // Activer : avec les réglages déjà enregistrés, ou en les choisissant (étapes 1 à 5).
      let start = choice;
      if (current?.channelId && current?.roleId) {
        await choice.update({
          content: `✅ **Activer la vérification** avec ces réglages ?\n${settingsText(current)}`,
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder().setCustomId('cfgv_keep').setLabel('Garder ces réglages').setStyle(ButtonStyle.Success),
              new ButtonBuilder().setCustomId('cfgv_new').setLabel('Changer les réglages').setStyle(ButtonStyle.Primary).setEmoji('⚙️'),
            ),
          ],
          allowedMentions: { parse: [] },
        });
        const keep = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 300_000, filter });
        if (keep.customId === 'cfgv_keep') {
          setVerifConfig(guild.id, { ...current, enabled: true });
          return keep.update({
            content: `✅ **Vérification activée** : les nouveaux membres passent de nouveau le captcha.\n${settingsText(current)}`,
            components: [],
            allowedMentions: { parse: [] },
          });
        }
        start = keep;
      }
      await start.update({ content: '**1/5 — Salon de vérification**\nOù les membres passeront-ils le captcha ?', components: [step1] });

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
        content: `✅ Rôle : <@&${config.roleId}>\n\n**3/5 — Nombre d’essais maximum**`,
        components: [selectRow('cfgv_attempts', 'Combien d’essais autorisés ?', ATTEMPT_OPTIONS)],
      });

      // ===== 3/5 — Essais max =====
      const attSel = await msg.awaitMessageComponent({ componentType: ComponentType.StringSelect, time: 300_000, filter });
      config.maxAttempts = Number(attSel.values[0]);
      await attSel.update({
        content: `✅ ${config.maxAttempts} essai(s) max\n\n**4/5 — Kick des non-vérifiés**\nAu bout de combien de temps expulser un membre qui n’a pas validé ?`,
        components: [selectRow('cfgv_kick', 'Délai avant kick', KICK_OPTIONS)],
      });

      // ===== 4/5 — Délai de kick =====
      const kickSel = await msg.awaitMessageComponent({ componentType: ComponentType.StringSelect, time: 300_000, filter });
      config.kickAfterMs = kickSel.values[0] === 'none' ? null : Number(kickSel.values[0]);

      // ===== 5/5 — Salon de mention après réussite =====
      const mentionRow = new ActionRowBuilder().addComponents(
        new ChannelSelectMenuBuilder()
          .setCustomId('cfgv_mention')
          .setPlaceholder('Salon où mentionner le membre vérifié')
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          .setMinValues(1)
          .setMaxValues(1),
      );
      const noneRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cfgv_nomention').setLabel('Aucun').setStyle(ButtonStyle.Secondary),
      );
      await kickSel.update({
        content:
          '**5/5 — Mention après réussite**\nDans quel salon veux-tu que le nouveau membre soit mentionné après avoir réussi la vérification ?\n_(le message de mention sera supprimé aussitôt — ping fantôme)_',
        components: [mentionRow, noneRow],
      });

      const finalSel = await msg.awaitMessageComponent({ time: 300_000, filter });
      config.successMentionChannelId =
        finalSel.componentType === ComponentType.ChannelSelect ? finalSel.values[0] : null;

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

      await finalSel.update({
        content:
          `✅ **Vérification configurée !**\n` +
          `• Salon : <#${config.channelId}>\n` +
          `• Rôle après validation : <@&${config.roleId}>\n` +
          `• Essais max : ${config.maxAttempts}\n` +
          `• Délai : ${kickText}\n` +
          `• Mention après réussite : ${config.successMentionChannelId ? `<#${config.successMentionChannelId}>` : 'aucune'}`,
        components: [],
        embeds: [],
      });
    } catch (err) {
      console.error(err);
      return interaction.editReply({ content: '⏱️ Configuration annulée (délai dépassé ou erreur). Relance `/configverif`.', components: [], embeds: [] }).catch(() => {});
    }
  },
};

// Résumé des réglages enregistrés (salon, rôle, essais, kick, mention).
function settingsText(cfg) {
  const kick =
    cfg.kickAfterMs == null
      ? 'aucun kick'
      : `kick après ${KICK_OPTIONS.find((o) => o.value === String(cfg.kickAfterMs))?.label.replace('Après ', '') ?? `${Math.round(cfg.kickAfterMs / 60_000)} min`}`;
  return (
    `• Salon : ${cfg.channelId ? `<#${cfg.channelId}>` : '—'} · Rôle après validation : ${cfg.roleId ? `<@&${cfg.roleId}>` : '—'}\n` +
    `• Essais max : ${cfg.maxAttempts ?? 3} · ${kick} · Mention après réussite : ${cfg.successMentionChannelId ? `<#${cfg.successMentionChannelId}>` : 'aucune'}`
  );
}

// Désactivation : plus de captcha, de kick ni de rappel ; les nouveaux reçoivent directement le rôle.
// Les réglages sont gardés pour la réactiver. Les membres qui attendaient peuvent être laissés entrer d'un coup.
async function disable(interaction, button, msg, filter, current, enabled) {
  if (!current || !enabled) {
    return button.update({
      content: !current ? 'ℹ️ La vérification n’est pas configurée : rien à désactiver.' : 'ℹ️ La vérification est déjà **désactivée**.',
      components: [],
    });
  }
  setVerifConfig(interaction.guild.id, { ...current, enabled: false });
  await button.update({ content: '⏳ Désactivation…', components: [] });
  const waiting = await countUnverified(interaction.guild);
  const text =
    `⛔ **Vérification désactivée** : plus de captcha, de kick ni de rappel. Les nouveaux membres reçoivent directement ${current.roleId ? `<@&${current.roleId}>` : 'le rôle de vérifié'}.\n` +
    '-# Tes réglages sont gardés : `/configverif` → **Activer** pour la remettre.';
  if (!waiting) return interaction.editReply({ content: text, allowedMentions: { parse: [] } });

  await interaction.editReply({
    content: `${text}\n\n👥 **${waiting}** membre(s) attendent encore la vérification. Les laisser entrer (rôle donné à tous) ?`,
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cfgv_letin').setLabel(`Laisser entrer les ${waiting}`).setStyle(ButtonStyle.Success).setEmoji('🚪'),
        new ButtonBuilder().setCustomId('cfgv_keepout').setLabel('Non').setStyle(ButtonStyle.Secondary),
      ),
    ],
    allowedMentions: { parse: [] },
  });
  const answer = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 300_000, filter }).catch(() => null);
  if (!answer || answer.customId === 'cfgv_keepout') {
    const final = { content: `${text}\n-# Les membres en attente n’ont pas été touchés (\`/passer-verif\` pour les laisser entrer).`, components: [], allowedMentions: { parse: [] } };
    return (answer ? answer.update(final) : interaction.editReply(final)).catch(() => {});
  }
  await answer.update({ content: `${text}\n\n⏳ J’ouvre la porte aux ${waiting} membre(s)…`, components: [], allowedMentions: { parse: [] } });
  const res = await forceVerifyAll(interaction.guild, interaction.user).catch(() => null);
  return interaction.editReply({
    content: `${text}\n\n🚪 ${res?.ok ? `**${res.verified}** membre(s) sont entrés${res.failed ? ` (${res.failed} impossible(s) : rôle trop haut pour moi ?)` : ''}.` : 'Je n’ai pas pu donner le rôle aux membres en attente.'}`,
    allowedMentions: { parse: [] },
  });
}
