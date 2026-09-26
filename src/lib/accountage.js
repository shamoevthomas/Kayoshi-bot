import { EmbedBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
import { sendSanctionLog, Colors } from './logger.js';
import { dmSanction } from './sanctions.js';

// Comptes trop récents (créés il y a moins de 2 jours) : expulsés dès l'arrivée.
const MIN_ACCOUNT_AGE_MS = 2 * 86_400_000;
const REASON = 'Compte récent';

export function isRecentAccount(user) {
  return Date.now() - user.createdTimestamp < MIN_ACCOUNT_AGE_MS;
}

// Invitation à envoyer au membre expulsé : lien personnalisé du serveur, sinon
// une invitation permanente (réutilisée d'une fois sur l'autre grâce à
// unique:false), sinon celle qu'il a utilisée pour rejoindre.
async function serverInvite(guild, usedCode) {
  if (guild.vanityURLCode) return guild.vanityURLCode;
  const me = guild.members.me;
  const channel =
    guild.systemChannel ??
    guild.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.permissionsFor(me)?.has(PermissionFlagsBits.CreateInstantInvite),
    );
  const invite = channel
    ? await guild.invites
        .create(channel, { maxAge: 0, unique: false, reason: 'Invitation pour les comptes récents expulsés' })
        .catch(() => null)
    : null;
  return invite?.code ?? usedCode ?? null;
}

// Expulse le membre si son compte est trop récent. Renvoie true s'il a été expulsé.
// usedCode : code de l'invitation utilisée (repli si le serveur n'a pas d'invitation dédiée).
export async function kickIfRecentAccount(member, usedCode = null) {
  if (!isRecentAccount(member.user)) return false;
  const guild = member.guild;
  const created = Math.floor(member.user.createdTimestamp / 1000);
  const back = Math.floor((member.user.createdTimestamp + MIN_ACCOUNT_AGE_MS) / 1000);

  if (!member.kickable) {
    await sendSanctionLog(
      guild,
      new EmbedBuilder()
        .setColor(Colors.edit)
        .setAuthor({ name: '⚠️ Compte récent non expulsé', iconURL: member.user.displayAvatarURL() })
        .setDescription(`${member} (${member.user.tag}) — je n’ai pas la permission de l’expulser.`)
        .addFields({ name: 'Compte créé', value: `<t:${created}:R>`, inline: true })
        .setTimestamp(),
    );
    return false;
  }

  // MP AVANT l'expulsion (plus joignable par le serveur ensuite).
  const dmSent = await dmSanction(
    member.user,
    guild,
    'expulsé',
    `${REASON} : ton compte doit avoir au moins 2 jours. Tu pourras revenir <t:${back}:R>.`,
    null,
    false,
  );
  // Invitation dans un 2ᵉ MP : seule dans le message, Discord affiche la carte « Rejoindre ».
  const code = dmSent ? await serverInvite(guild, usedCode) : null;
  const inviteSent = code
    ? await member.user
        .send(`🔗 Voici l’invitation pour revenir quand ton compte aura 2 jours : https://discord.gg/${code}`)
        .then(() => true)
        .catch(() => false)
    : false;
  const kicked = await member.kick(REASON).then(() => true).catch(() => false);
  if (!kicked) return false;

  await sendSanctionLog(
    guild,
    new EmbedBuilder()
      .setColor(Colors.leave)
      .setAuthor({ name: '👢 Membre expulsé (compte récent)', iconURL: member.user.displayAvatarURL() })
      .setDescription(`${member.user.tag} (\`${member.id}\`)`)
      .addFields(
        { name: 'Raison', value: REASON },
        { name: 'Compte créé', value: `<t:${created}:R>`, inline: true },
        { name: 'MP envoyé', value: dmSent ? '✅ oui' : '❌ non (MP fermés)', inline: true },
        { name: 'Invitation envoyée', value: inviteSent ? `✅ discord.gg/${code}` : '❌ non', inline: true },
      )
      .setTimestamp(),
  );
  return true;
}
