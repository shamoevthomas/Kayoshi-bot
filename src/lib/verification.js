import { EmbedBuilder, AttachmentBuilder } from 'discord.js';
import { generateCaptcha } from './captcha.js';
import { getVerifConfig } from './store.js';
import { sendLog, Colors } from './logger.js';

// État en mémoire (perdu au redémarrage, reconstruit à la volée quand un membre écrit).
const pending = new Map(); // userId -> { answer, attempts, captchaMessageId }
const kickTimers = new Map(); // userId -> timeout

function clearKickTimer(userId) {
  const t = kickTimers.get(userId);
  if (t) clearTimeout(t);
  kickTimers.delete(userId);
}

async function deleteCaptchaMessage(channel, record) {
  if (record?.captchaMessageId) await channel.messages.delete(record.captchaMessageId).catch(() => {});
}

// Supprime le(s) message(s) de captcha d'un membre dans le salon de vérification.
// Fiable même après un redémarrage du bot (l'enregistrement mémoire est perdu) :
// on scanne aussi les messages récents pour retrouver le captcha du membre.
async function purgeMemberCaptcha(guild, config, member, record) {
  const channel = guild.channels.cache.get(config.channelId);
  if (!channel?.isTextBased()) return;

  // 1) Message connu via l'état en mémoire.
  if (record?.captchaMessageId) await channel.messages.delete(record.captchaMessageId).catch(() => {});

  // 2) Repli : on retrouve les captchas du membre postés par le bot
  //    (message qui le mentionne + image/embed de vérification).
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  if (!recent) return;
  const botId = guild.client.user.id;
  const captchas = recent.filter(
    (m) =>
      m.author.id === botId &&
      m.id !== record?.captchaMessageId &&
      m.mentions.users.has(member.id) &&
      (m.attachments.size > 0 || m.embeds.some((e) => e.author?.name?.includes('Vérification'))),
  );
  for (const [, m] of captchas) await m.delete().catch(() => {});
}

// Purge tous les captchas restants du salon de vérification (nettoyage en masse).
async function purgeAllCaptchas(guild, config) {
  const channel = guild.channels.cache.get(config.channelId);
  if (!channel?.isTextBased()) return;
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  if (!recent) return;
  const botId = guild.client.user.id;
  const captchas = recent.filter(
    (m) =>
      m.author.id === botId &&
      (m.attachments.size > 0 || m.embeds.some((e) => e.author?.name?.includes('Vérification'))),
  );
  for (const [, m] of captchas) await m.delete().catch(() => {});
}

// Poste (ou reposte) un captcha pour un membre dans le salon de vérification.
// Embed : image + essais restants + compte à rebours d'expulsion en direct
// (timestamp relatif Discord, mis à jour automatiquement côté client).
async function postCaptcha(channel, member, config, attempts = 0) {
  const { text, buffer } = generateCaptcha();
  const file = new AttachmentBuilder(buffer, { name: 'captcha.png' });

  const attemptsLeft = config.maxAttempts - attempts;
  const embed = new EmbedBuilder()
    .setColor(Colors.role)
    .setAuthor({ name: '🛡️ Vérification', iconURL: member.guild.iconURL() ?? undefined })
    .setDescription(`${member}, recopie le texte de l’image **dans ce salon** pour accéder au serveur.`)
    .setImage('attachment://captcha.png')
    .addFields({ name: 'Essais restants', value: `**${attemptsLeft}**`, inline: true });

  if (config.kickAfterMs != null) {
    const deadline = Math.floor(((member.joinedTimestamp ?? Date.now()) + config.kickAfterMs) / 1000);
    embed.addFields({ name: 'Expulsion', value: `<t:${deadline}:R>`, inline: true });
    embed.setFooter({ text: 'Vérifie-toi avant la fin du compte à rebours.' });
  }

  const msg = await channel.send({
    content: `${member}`,
    embeds: [embed],
    files: [file],
    allowedMentions: { users: [member.id] },
  });
  pending.set(member.id, { answer: text, attempts, captchaMessageId: msg.id });
}

// Programme le kick d'un membre non vérifié (si l'option kick est active).
function scheduleKick(member, config) {
  if (config.kickAfterMs == null) return;
  clearKickTimer(member.id);
  const elapsed = Date.now() - (member.joinedTimestamp ?? Date.now());
  const delay = Math.max(0, config.kickAfterMs - elapsed);
  const timer = setTimeout(async () => {
    kickTimers.delete(member.id);
    const fresh = await member.guild.members.fetch(member.id).catch(() => null);
    if (fresh && !fresh.roles.cache.has(config.roleId)) {
      pending.delete(member.id);
      await fresh.kick('Non vérifié dans le délai imparti').catch(() => {});
      await sendLog(
        member.guild,
        new EmbedBuilder()
          .setColor(Colors.leave)
          .setAuthor({ name: '🛡️ Expulsé (non vérifié)' })
          .setDescription(`${fresh.user.tag} n’a pas passé la vérification à temps.`)
          .setTimestamp(),
      );
    }
  }, delay);
  kickTimers.set(member.id, timer);
}

// Au départ d'un membre : supprime son message de vérification et nettoie son état.
export async function onMemberLeave(member) {
  const record = pending.get(member.id);
  clearKickTimer(member.id);
  pending.delete(member.id);
  if (!record?.captchaMessageId) return;
  const config = getVerifConfig(member.guild.id);
  const channel = config && member.guild.channels.cache.get(config.channelId);
  if (channel?.isTextBased()) await channel.messages.delete(record.captchaMessageId).catch(() => {});
}

// Force la validation d'un membre (comme s'il avait réussi le captcha) : ajoute le
// rôle, nettoie l'état en attente et le timer de kick. Renvoie un statut.
export async function forceVerify(member, executor = null) {
  const config = getVerifConfig(member.guild.id);
  if (!config) return { ok: false, reason: 'no-config' };
  if (member.user.bot) return { ok: false, reason: 'bot' };
  if (member.roles.cache.has(config.roleId)) return { ok: false, reason: 'already' };

  const record = pending.get(member.id);
  pending.delete(member.id);
  clearKickTimer(member.id);

  // Supprime le(s) message(s) de captcha du membre (même après un redémarrage).
  await purgeMemberCaptcha(member.guild, config, member, record).catch(() => {});

  await member.roles.add(config.roleId);
  await sendLog(
    member.guild,
    new EmbedBuilder()
      .setColor(Colors.join)
      .setAuthor({ name: '🛡️ Membre vérifié (manuel)' })
      .setDescription(`${member} a été vérifié manuellement.`)
      .addFields(...(executor ? [{ name: 'Par', value: `${executor}`, inline: true }] : []))
      .setTimestamp(),
  );
  return { ok: true };
}

// Valide TOUS les membres non vérifiés d'un coup, sans spammer les logs
// (un seul récapitulatif). Renvoie les compteurs.
export async function forceVerifyAll(guild, executor = null) {
  const config = getVerifConfig(guild.id);
  if (!config) return { ok: false, reason: 'no-config' };

  const members = await guild.members.fetch().catch(() => null);
  if (!members) return { ok: false, reason: 'fetch-failed' };

  let verified = 0;
  let skipped = 0;
  let failed = 0;

  for (const [, member] of members) {
    if (member.user.bot || member.roles.cache.has(config.roleId)) {
      skipped += 1;
      continue;
    }
    // Nettoie l'état en attente + le timer de kick de ce membre.
    pending.delete(member.id);
    clearKickTimer(member.id);
    try {
      await member.roles.add(config.roleId);
      verified += 1;
    } catch {
      failed += 1;
    }
  }

  // Nettoie les captchas restants dans le salon de vérification.
  await purgeAllCaptchas(guild, config).catch(() => {});

  // Un seul log récapitulatif (au lieu d'un par membre).
  await sendLog(
    guild,
    new EmbedBuilder()
      .setColor(Colors.join)
      .setAuthor({ name: '🛡️ Vérification en masse' })
      .setDescription(`**${verified}** membre(s) vérifié(s) manuellement.`)
      .addFields(
        { name: 'Ignorés (déjà vérifiés / bots)', value: `${skipped}`, inline: true },
        ...(failed ? [{ name: '⚠️ Échecs', value: `${failed}`, inline: true }] : []),
        ...(executor ? [{ name: 'Par', value: `${executor}`, inline: true }] : []),
      )
      .setTimestamp(),
  );

  return { ok: true, verified, skipped, failed };
}

// À l'arrivée d'un membre : poste le captcha + programme le kick éventuel.
export async function onMemberJoin(member) {
  if (member.user.bot) return;
  const config = getVerifConfig(member.guild.id);
  if (!config) return;
  const channel = member.guild.channels.cache.get(config.channelId);
  if (channel?.isTextBased()) await postCaptcha(channel, member, config, 0).catch(() => {});
  scheduleKick(member, config);
}

// Sur chaque message dans le salon de vérification : valide la réponse.
export async function handleVerifyMessage(message) {
  if (!message.guild || message.author.bot) return;
  const config = getVerifConfig(message.guild.id);
  if (!config || message.channel.id !== config.channelId) return;

  const member = message.member;
  if (!member) return;

  // Déjà vérifié → on nettoie juste son message
  if (member.roles.cache.has(config.roleId)) {
    await message.delete().catch(() => {});
    return;
  }

  const answer = message.content.trim();
  await message.delete().catch(() => {});

  const record = pending.get(message.author.id);
  // Pas de captcha en cours (ex: redémarrage) → on en génère un
  if (!record) {
    await postCaptcha(message.channel, member, config, 0).catch(() => {});
    return;
  }

  // Bonne réponse
  if (answer.toLowerCase() === record.answer.toLowerCase()) {
    pending.delete(message.author.id);
    clearKickTimer(message.author.id);
    await deleteCaptchaMessage(message.channel, record);
    await member.roles.add(config.roleId).catch(() => {});
    const ok = await message.channel.send(`✅ ${member}, vérification réussie ! Bienvenue 🎉`);
    setTimeout(() => ok.delete().catch(() => {}), 6000);
    await sendLog(
      message.guild,
      new EmbedBuilder()
        .setColor(Colors.join)
        .setAuthor({ name: '🛡️ Membre vérifié' })
        .setDescription(`${member} a réussi la vérification.`)
        .setTimestamp(),
    );
    return;
  }

  // Mauvaise réponse
  const attempts = record.attempts + 1;
  await deleteCaptchaMessage(message.channel, record);
  const kickEnabled = config.kickAfterMs != null;

  if (attempts >= config.maxAttempts) {
    if (kickEnabled) {
      pending.delete(message.author.id);
      clearKickTimer(message.author.id);
      const warn = await message.channel.send(`❌ ${member}, trop d’essais. Tu vas être expulsé — tu pourras revenir et réessayer.`);
      setTimeout(() => warn.delete().catch(() => {}), 6000);
      await member.kick('Captcha échoué (trop d’essais)').catch(() => {});
      return;
    }
    // Option "pas de kick" : on repart à zéro sans expulser
    await postCaptcha(message.channel, member, config, 0).catch(() => {});
    return;
  }

  const left = config.maxAttempts - attempts;
  const notice = await message.channel.send(`❌ ${member}, mauvaise réponse. Il te reste **${left}** essai(s).`);
  setTimeout(() => notice.delete().catch(() => {}), 5000);
  await postCaptcha(message.channel, member, config, attempts).catch(() => {});
}

// Au démarrage : reprogramme les kicks des membres encore non vérifiés.
export async function reconcileVerification(client) {
  for (const [, guild] of client.guilds.cache) {
    const config = getVerifConfig(guild.id);
    if (!config || config.kickAfterMs == null) continue;
    const members = await guild.members.fetch().catch(() => null);
    if (!members) continue;
    for (const [, member] of members) {
      if (member.user.bot || member.roles.cache.has(config.roleId)) continue;
      scheduleKick(member, config);
    }
  }
}
