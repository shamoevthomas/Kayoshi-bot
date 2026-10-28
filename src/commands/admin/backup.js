import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { loadBackups } from '../../lib/store.js';
import { createBackup, describe, backupFile, readBackupFile, missingCount, restoreBackup } from '../../lib/backup.js';

// Sauvegardes du serveur : rôles, salons et permissions (voir lib/backup.js).
const pickOption = (o, required) =>
  o.setName('sauvegarde').setDescription('La sauvegarde (la plus récente en premier)').setAutocomplete(true).setRequired(required);

export default {
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Sauvegarder le serveur (rôles, salons, permissions) et recréer ce qui a disparu.')
    .addSubcommand((s) => s.setName('creer').setDescription('Faire une sauvegarde maintenant (en plus de la sauvegarde automatique de chaque jour).'))
    .addSubcommand((s) => s.setName('liste').setDescription('Voir les sauvegardes enregistrées.'))
    .addSubcommand((s) => s.setName('telecharger').setDescription('Recevoir une sauvegarde en fichier.').addStringOption((o) => pickOption(o, true)))
    .addSubcommand((s) =>
      s
        .setName('restaurer')
        .setDescription('Recréer les rôles et salons qui manquent (rien n’est supprimé ni modifié).')
        .addStringOption((o) => pickOption(o, false))
        .addAttachmentOption((o) => o.setName('fichier').setDescription('Ou un fichier de sauvegarde (.json) reçu avec /backup telecharger')),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async autocomplete(interaction) {
    const list = await loadBackups(interaction.guild.id).catch(() => []);
    await interaction.respond(
      list.slice(0, 25).map((b) => ({
        name: `${b.auto ? 'Auto' : 'Manuelle'} du ${new Date(b.createdAt).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' })} — ${b.roles.length} rôles, ${b.channels.length} salons`,
        value: b.id,
      })),
    );
  },

  async execute(interaction) {
    const { guild } = interaction;
    const sub = interaction.options.getSubcommand();
    await interaction.deferReply({ ephemeral: true });

    if (sub === 'creer') {
      const b = await createBackup(guild);
      return interaction.editReply({ content: `✅ Sauvegarde ${describe(b)}.\n-# Le fichier est joint : garde-le en lieu sûr si tu veux.`, files: [backupFile(b)] });
    }

    const list = await loadBackups(guild.id);
    if (sub === 'liste') {
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('💾 Sauvegardes du serveur')
        .setDescription(list.length ? list.map((b, i) => `**${i + 1}.** ${describe(b)}`).join('\n') : '_Aucune sauvegarde pour l’instant : `/backup creer`._')
        .setFooter({ text: 'Une sauvegarde automatique par jour (3 gardées) + 5 manuelles. Messages et membres ne sont pas sauvegardés.' });
      return interaction.editReply({ embeds: [embed] });
    }

    const id = interaction.options.getString('sauvegarde');
    if (sub === 'telecharger') {
      const b = list.find((x) => x.id === id);
      if (!b) return interaction.editReply('❌ Sauvegarde introuvable : choisis-la dans la liste.');
      return interaction.editReply({ content: `💾 Sauvegarde ${describe(b)}.`, files: [backupFile(b)] });
    }

    // restaurer : aperçu, confirmation, puis recréation de ce qui manque.
    const file = interaction.options.getAttachment('fichier');
    const backup = file ? await readBackupFile(file) : id ? list.find((x) => x.id === id) : null;
    if (!backup) {
      return interaction.editReply(file ? '❌ Ce fichier n’est pas une sauvegarde valide.' : '❌ Choisis une sauvegarde dans la liste, ou joins un fichier de sauvegarde.');
    }
    const missing = missingCount(guild, backup);
    if (!missing.roles && !missing.channels) return interaction.editReply('✅ Rien ne manque : tous les rôles et salons de cette sauvegarde sont là.');
    const other = backup.guildId !== guild.id ? `\n⚠️ Cette sauvegarde vient d’un autre serveur (**${backup.guildName}**) : les éléments sont retrouvés par leur nom.` : '';
    const confirm = await interaction.editReply({
      content:
        `♻️ Sauvegarde ${describe(backup)}.\nÀ recréer : **${missing.roles}** rôle(s) et **${missing.channels}** salon(s), avec leurs permissions. ` +
        `Rien n’est supprimé ni modifié.${other}\n-# Les rôles recréés arrivent en bas de la liste des rôles. Ça peut prendre quelques minutes.`,
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('bkp_ok').setLabel('Restaurer').setEmoji('♻️').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('bkp_no').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
    const click = await confirm.awaitMessageComponent({ time: 60_000, filter: (i) => i.user.id === interaction.user.id }).catch(() => null);
    if (!click || click.customId === 'bkp_no') return interaction.editReply({ content: click ? 'Restauration annulée.' : '⌛ Restauration annulée (pas de réponse).', components: [] });
    await click.update({ content: '♻️ Restauration en cours…', components: [] });

    let lastEdit = 0;
    const stats = await restoreBackup(guild, backup, async (s) => {
      if (Date.now() - lastEdit < 3000) return;
      lastEdit = Date.now();
      await interaction.editReply(`♻️ Restauration en cours… ${s.roles} rôle(s) et ${s.channels} salon(s) recréés.`).catch(() => {});
    });
    const errors = stats.errors.length ? `\n⚠️ ${stats.errors.length} problème(s) :\n${stats.errors.slice(0, 10).map((e) => `• ${e}`).join('\n')}` : '';
    const summary = `✅ Restauration terminée : **${stats.roles}** rôle(s) et **${stats.channels}** salon(s) recréés, ${stats.kept} déjà présents.${errors}`.slice(0, 2000);
    // Après 15 min, la réponse ne peut plus être modifiée : le résumé part dans le salon.
    await interaction.editReply(summary).catch(() => interaction.channel?.send({ content: summary, allowedMentions: { parse: [] } }).catch(() => {}));
  },
};
