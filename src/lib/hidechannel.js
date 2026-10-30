import { PermissionFlagsBits } from 'discord.js';

// « +hide [#salon] » / « +unhide [#salon] » (staff : Gérer les salons) : masque ou réaffiche un salon (celui où
// la commande est écrite, ou celui mentionné) pour le rôle Membre de Hanami. Seule la permission « Voir le
// salon » de ce rôle change ; ses autres permissions sur le salon sont gardées.
const HIDE_ROLE_ID = '1563160648345591818';
const reply = (message, content) => message.reply({ content, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});

export async function handleHideCommand(message) {
  if (!message.guild || message.author.bot) return false;
  const [cmd, arg] = message.content.trim().split(/\s+/);
  const hide = cmd.toLowerCase() === '+hide';
  if (!hide && cmd.toLowerCase() !== '+unhide') return false;
  // Réservé au staff : les autres sont ignorés sans réponse.
  if (!message.member?.permissions.has(PermissionFlagsBits.ManageChannels)) return true;

  const role = message.guild.roles.cache.get(HIDE_ROLE_ID);
  if (!role) {
    await reply(message, '❌ Le rôle à masquer n’existe pas sur ce serveur.');
    return true;
  }
  const id = arg?.match(/^<#(\d+)>$/)?.[1] ?? arg?.match(/^(\d{17,20})$/)?.[1];
  let channel = arg ? (id ? message.guild.channels.cache.get(id) : null) : message.channel;
  if (channel?.isThread?.()) channel = channel.parent;
  if (!channel?.permissionOverwrites) {
    await reply(message, `❌ Salon introuvable. Utilisation : \`${hide ? '+hide' : '+unhide'} [#salon]\`.`);
    return true;
  }

  const visible = () => channel.permissionsFor(role).has(PermissionFlagsBits.ViewChannel);
  const reason = `${hide ? '+hide' : '+unhide'} par ${message.author.tag}`;
  try {
    if (hide) {
      if (!visible()) {
        await reply(message, `ℹ️ ${channel} est déjà masqué pour ${role}.`);
        return true;
      }
      await channel.permissionOverwrites.edit(role, { ViewChannel: false }, { reason });
    } else {
      if (visible()) {
        await reply(message, `ℹ️ ${channel} est déjà visible pour ${role}.`);
        return true;
      }
      // Le refus est retiré ; si le salon reste caché (salon privé), « Voir le salon » est autorisé.
      await channel.permissionOverwrites.edit(role, { ViewChannel: null }, { reason });
      if (!visible()) await channel.permissionOverwrites.edit(role, { ViewChannel: true }, { reason });
    }
  } catch {
    await reply(message, `❌ Je n’ai pas pu modifier ${channel} (il me faut la permission « Gérer les rôles » sur ce salon).`);
    return true;
  }
  await reply(message, hide ? `🙈 ${channel} est maintenant **masqué** pour ${role}.` : `👀 ${channel} est de nouveau **visible** pour ${role}.`);
  return true;
}
