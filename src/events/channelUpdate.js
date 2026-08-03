import { Events, EmbedBuilder, AuditLogEvent, OverwriteType } from 'discord.js';
import { sendLog, Colors, findExecutor } from '../lib/logger.js';

// Noms FR des permissions les plus courantes (repli sur le nom brut sinon).
const permLabels = {
  ViewChannel: 'Voir le salon',
  SendMessages: 'Envoyer des messages',
  SendMessagesInThreads: 'Écrire dans les fils',
  CreatePublicThreads: 'Créer des fils publics',
  CreatePrivateThreads: 'Créer des fils privés',
  ManageMessages: 'Gérer les messages',
  ManageChannels: 'Gérer le salon',
  ManageRoles: 'Gérer les permissions',
  ManageWebhooks: 'Gérer les webhooks',
  ReadMessageHistory: "Voir l'historique",
  AddReactions: 'Ajouter des réactions',
  AttachFiles: 'Joindre des fichiers',
  EmbedLinks: 'Intégrer des liens',
  MentionEveryone: 'Mentionner @everyone',
  UseApplicationCommands: 'Utiliser les commandes',
  UseExternalEmojis: 'Émojis externes',
  Connect: 'Se connecter',
  Speak: 'Parler',
  Stream: 'Partager sa vidéo',
  MuteMembers: 'Rendre muet',
  DeafenMembers: 'Rendre sourd',
  MoveMembers: 'Déplacer des membres',
  PrioritySpeaker: 'Voix prioritaire',
};
const label = (p) => permLabels[p] ?? p;

// Compare les permissions (overwrites) de deux versions d'un salon.
// Renvoie [{ target, text }] pour chaque cible (rôle/membre) modifiée.
function diffOverwrites(oldCh, newCh) {
  const ids = new Set([
    ...oldCh.permissionOverwrites.cache.keys(),
    ...newCh.permissionOverwrites.cache.keys(),
  ]);
  const changes = [];
  for (const id of ids) {
    const o = oldCh.permissionOverwrites.cache.get(id);
    const n = newCh.permissionOverwrites.cache.get(id);
    const oAllow = o ? o.allow.toArray() : [];
    const oDeny = o ? o.deny.toArray() : [];
    const nAllow = n ? n.allow.toArray() : [];
    const nDeny = n ? n.deny.toArray() : [];
    if (oAllow.join() === nAllow.join() && oDeny.join() === nDeny.join()) continue;

    const allowAdded = nAllow.filter((p) => !oAllow.includes(p));
    const denyAdded = nDeny.filter((p) => !oDeny.includes(p));
    const neutralised = [...new Set([...oAllow, ...oDeny])].filter(
      (p) => !nAllow.includes(p) && !nDeny.includes(p),
    );

    const parts = [];
    if (allowAdded.length) parts.push(`✅ ${allowAdded.map(label).join(', ')}`);
    if (denyAdded.length) parts.push(`⛔ ${denyAdded.map(label).join(', ')}`);
    if (neutralised.length) parts.push(`➖ ${neutralised.map(label).join(', ')}`);

    const ref = n ?? o;
    const target = ref.type === OverwriteType.Role ? `<@&${id}>` : `<@${id}>`;
    changes.push({ target, text: parts.join(' • ') || '_modifié_' });
  }
  return changes;
}

export default {
  name: Events.ChannelUpdate,
  async execute(oldCh, newCh) {
    if (!newCh.guild) return;

    const fields = [];
    if (oldCh.name !== newCh.name) {
      fields.push({ name: 'Nom', value: `\`${oldCh.name}\` → \`${newCh.name}\``, inline: false });
    }

    const permChanges = diffOverwrites(oldCh, newCh);
    if (permChanges.length) {
      let value = permChanges.map((c) => `${c.target} → ${c.text}`).join('\n');
      if (value.length > 1024) value = value.slice(0, 1000) + '\n… (tronqué)';
      fields.push({ name: 'Permissions modifiées', value, inline: false });
    }

    // On ignore les changements non pertinents (position, slowmode, etc.).
    if (!fields.length) return;

    // Auteur : événement d'audit différent selon nom vs permissions.
    let executor = null;
    if (permChanges.length) {
      for (const t of [
        AuditLogEvent.ChannelOverwriteUpdate,
        AuditLogEvent.ChannelOverwriteCreate,
        AuditLogEvent.ChannelOverwriteDelete,
      ]) {
        executor = await findExecutor(newCh.guild, t, newCh.id);
        if (executor) break;
      }
    }
    if (!executor) executor = await findExecutor(newCh.guild, AuditLogEvent.ChannelUpdate, newCh.id);

    const embed = new EmbedBuilder()
      .setColor(Colors.channel)
      .setAuthor({ name: '📝 Salon modifié' })
      .setDescription(`${newCh} (**${newCh.name}**)`)
      .addFields(fields)
      .setTimestamp();

    if (executor) embed.addFields({ name: 'Par', value: `${executor}`, inline: true });
    await sendLog(newCh.guild, embed);
  },
};
