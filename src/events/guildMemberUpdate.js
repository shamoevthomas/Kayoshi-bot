import { Events, EmbedBuilder, AuditLogEvent } from 'discord.js';
import { sendLog, Colors, findExecutor, findAuditEntry } from '../lib/logger.js';

export default {
  name: Events.GuildMemberUpdate,
  async execute(oldMember, newMember) {
    const guild = newMember.guild;

    // --- Mute / Unmute (timeout) ---
    const oldTo = oldMember.communicationDisabledUntilTimestamp ?? null;
    const newTo = newMember.communicationDisabledUntilTimestamp ?? null;
    if (oldTo !== newTo) {
      const entry = await findAuditEntry(guild, AuditLogEvent.MemberUpdate, newMember.id);
      // La commande /mute du bot loggue déjà → on ignore si l'exécuteur est le bot.
      // Pas d'exécuteur = fin de timeout automatique → on ne loggue pas.
      if (entry?.executor && entry.executor.id !== guild.client.user.id) {
        const muted = newTo && newTo > Date.now();
        await sendLog(
          guild,
          new EmbedBuilder()
            .setColor(muted ? Colors.channel : Colors.join)
            .setAuthor({ name: muted ? '🔇 Membre rendu muet' : '🔊 Membre démuet' })
            .setDescription(`${newMember.user.tag} (\`${newMember.id}\`)`)
            .addFields(
              ...(muted ? [{ name: 'Jusqu’à', value: `<t:${Math.floor(newTo / 1000)}:F>`, inline: true }] : []),
              { name: 'Raison', value: entry.reason || 'Aucune raison précisée' },
              { name: 'Par', value: `${entry.executor}`, inline: true },
            )
            .setTimestamp(),
        );
      }
    }

    // --- Changement de pseudo (surnom sur le serveur) ---
    if (oldMember.nickname !== newMember.nickname) {
      const executor = await findExecutor(guild, AuditLogEvent.MemberUpdate, newMember.id);
      const oldNick = oldMember.nickname ?? `${newMember.user.username} (aucun)`;
      const newNick = newMember.nickname ?? `${newMember.user.username} (aucun)`;

      let title = '✏️ Pseudo modifié';
      if (!oldMember.nickname) title = '✏️ Pseudo ajouté';
      else if (!newMember.nickname) title = '✏️ Pseudo retiré';

      await sendLog(
        guild,
        new EmbedBuilder()
          .setColor(Colors.channel)
          .setAuthor({ name: title })
          .setDescription(`Membre : ${newMember} (${newMember.user.tag})`)
          .addFields(
            { name: 'Avant', value: `\`${oldNick}\``, inline: true },
            { name: 'Après', value: `\`${newNick}\``, inline: true },
            ...(executor && executor.id !== newMember.id ? [{ name: 'Par', value: `${executor}`, inline: true }] : []),
          )
          .setTimestamp(),
      );
    }

    const oldRoles = oldMember.roles.cache;
    const newRoles = newMember.roles.cache;
    const added = newRoles.filter((r) => !oldRoles.has(r.id));
    const removed = oldRoles.filter((r) => !newRoles.has(r.id));
    if (added.size === 0 && removed.size === 0) return;

    const executor = await findExecutor(guild, AuditLogEvent.MemberRoleUpdate, newMember.id);

    const embed = new EmbedBuilder()
      .setColor(Colors.role)
      .setAuthor({ name: '🎭 Changement de rôles' })
      .setDescription(`Membre : ${newMember} (${newMember.user.tag})`)
      .setTimestamp();

    if (added.size) {
      embed.addFields({ name: '➕ Ajoutés', value: added.map((r) => `${r}`).join(', ').slice(0, 1000) });
    }
    if (removed.size) {
      embed.addFields({ name: '➖ Retirés', value: removed.map((r) => `${r}`).join(', ').slice(0, 1000) });
    }
    if (executor) {
      embed.addFields({ name: 'Par', value: `${executor}`, inline: true });
    }

    await sendLog(guild, embed);
  },
};
