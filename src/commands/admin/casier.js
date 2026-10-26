import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, AuditLogEvent } from 'discord.js';
import { getSanctions, getWarns, getAllSanctions, getAllWarns } from '../../lib/store.js';
import { formatDuration } from '../../lib/time.js';
import { Colors } from '../../lib/logger.js';

// Casier : sanctions d'un membre, ou de tout le serveur sans membre ; filtre facultatif par type.
// Sources : sanctions données par le bot (enregistrées depuis le 26/10/2026), avertissements, et
// journal d'audit de Discord (45 derniers jours : sanctions faites à la main dans Discord, et celles
// du bot d'avant l'enregistrement).
const LABELS = {
  warn: '⚠️ Avertissement',
  mute: '🔇 Mute',
  unmute: '🔊 Démute',
  kick: '👢 Expulsion',
  ban: '🔨 Ban',
  softban: '⏳ Ban temporaire',
  unban: '♻️ Débannissement',
  derank: '📉 Derank',
};
// Option « sanction » → types affichés.
const FILTERS = {
  avertissement: { label: 'Avertissements', types: ['warn'] },
  expulsion: { label: 'Expulsions', types: ['kick'] },
  bannissement: { label: 'Bannissements', types: ['ban', 'softban'] },
  mute: { label: 'Mutes', types: ['mute'] },
};
const MAX_LINES = 20;
const MAX_TEXT = 3900; // sous la limite de 4096 caractères d'une description
const MENTION_OR_ID = /^(?:<@!?)?(\d{17,20})>?$/;
// Ban et ban temporaire sont le même événement dans le journal d'audit.
const sameKind = (a, b) => a === b || (['ban', 'softban'].includes(a) && ['ban', 'softban'].includes(b));

// Entrées du journal d'audit (d'un membre, ou de tous), sans celles déjà enregistrées par le bot.
async function auditEntries(guild, userId, known) {
  const out = [];
  for (const [event, type] of [
    [AuditLogEvent.MemberBanAdd, 'ban'],
    [AuditLogEvent.MemberBanRemove, 'unban'],
    [AuditLogEvent.MemberKick, 'kick'],
    [AuditLogEvent.MemberUpdate, 'mute'],
  ]) {
    const logs = await guild.fetchAuditLogs({ type: event, limit: 100 }).catch(() => null);
    for (const entry of logs?.entries.values() ?? []) {
      if (!entry.targetId || (userId && entry.targetId !== userId)) continue;
      let kind = type;
      let duration = null;
      if (event === AuditLogEvent.MemberUpdate) {
        const change = entry.changes.find((c) => c.key === 'communication_disabled_until');
        if (!change) continue;
        if (change.new) duration = Date.parse(change.new) - entry.createdTimestamp;
        else kind = 'unmute';
      }
      const duplicate = known.some(
        (k) => k.target === entry.targetId && sameKind(k.type, kind) && Math.abs(k.at - entry.createdTimestamp) < 15_000,
      );
      if (duplicate) continue;
      out.push({ target: entry.targetId, type: kind, reason: entry.reason, by: entry.executorId, at: entry.createdTimestamp, duration });
    }
  }
  return out;
}

// Toutes les sanctions (d'un membre si userId), chacune avec sa cible.
async function collect(guild, userId) {
  const byUser = (all) => Object.entries(all);
  const recorded = byUser(userId ? { [userId]: getSanctions(guild.id, userId) } : getAllSanctions(guild.id)).flatMap(([target, list]) =>
    list.map((s) => ({ ...s, target })),
  );
  const warns = byUser(userId ? { [userId]: getWarns(guild.id, userId) } : getAllWarns(guild.id)).flatMap(([target, list]) =>
    list.map((w) => ({ target, type: 'warn', reason: w.reason, by: w.moderatorId, at: w.ts })),
  );
  return [...recorded, ...warns, ...(await auditEntries(guild, userId, recorded))];
}

function line(entry, botId, showTarget) {
  const when = `<t:${Math.floor(entry.at / 1000)}:d>`;
  const target = showTarget ? ` <@${entry.target}>` : '';
  const duration = entry.duration > 0 ? ` (${formatDuration(entry.duration)})` : '';
  const by = !entry.by ? 'automatique' : entry.by === botId ? 'via le bot' : `par <@${entry.by}>`;
  const reason = entry.reason ? ` — ${entry.reason.length > 60 ? `${entry.reason.slice(0, 59)}…` : entry.reason}` : '';
  return `${when} ${LABELS[entry.type] ?? entry.type}${target}${duration}${reason} · ${by}`;
}

export default {
  data: new SlashCommandBuilder()
    .setName('casier')
    .setDescription('Sanctions d’un membre, ou de tout le serveur (filtre facultatif par type).')
    .addUserOption((o) => o.setName('membre').setDescription('(Facultatif) le membre ; sinon tout le serveur'))
    .addStringOption((o) =>
      o
        .setName('sanction')
        .setDescription('(Facultatif) seulement ce type de sanction')
        .addChoices(
          { name: 'Avertissement', value: 'avertissement' },
          { name: 'Expulsion', value: 'expulsion' },
          { name: 'Bannissement', value: 'bannissement' },
          { name: 'Mute', value: 'mute' },
        ),
    )
    .addStringOption((o) => o.setName('id').setDescription('(Facultatif) l’ID d’un utilisateur à la place du membre (ex : déjà banni)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false),

  async execute(interaction) {
    const { guild } = interaction;
    let user = interaction.options.getUser('membre');
    const rawId = interaction.options.getString('id')?.trim();
    if (!user && rawId) {
      const id = rawId.match(MENTION_OR_ID)?.[1];
      if (!id) return interaction.reply({ content: '❌ ID invalide : c’est un nombre de 17 à 20 chiffres.', ephemeral: true });
      user = await interaction.client.users.fetch(id).catch(() => null);
      if (!user) return interaction.reply({ content: '❌ Aucun utilisateur Discord ne correspond à cet ID.', ephemeral: true });
    }
    const filter = FILTERS[interaction.options.getString('sanction')] ?? null;

    await interaction.deferReply({ ephemeral: true });
    const all = (await collect(guild, user?.id)).sort((a, b) => b.at - a.at);
    const entries = filter ? all.filter((e) => filter.types.includes(e.type)) : all;

    // Lignes les plus récentes, dans la limite de taille d'un embed.
    const lines = [];
    let size = 0;
    for (const entry of entries.slice(0, MAX_LINES)) {
      const text = line(entry, interaction.client.user.id, !user);
      if (size + text.length + 1 > MAX_TEXT) break;
      lines.push(text);
      size += text.length + 1;
    }
    const empty = user ? '✨ Casier vierge : aucune sanction trouvée.' : '✨ Aucune sanction trouvée sur le serveur.';
    const more = entries.length > lines.length ? `\n… et ${entries.length - lines.length} plus ancienne(s)` : '';
    const count = (...types) => all.filter((e) => types.includes(e.type)).length;

    const embed = new EmbedBuilder()
      .setColor(Colors.delete)
      .setAuthor(user ? { name: `Casier de ${user.tag}`, iconURL: user.displayAvatarURL() } : { name: `Sanctions du serveur ${guild.name}` })
      .setDescription((filter ? `**${filter.label}**\n` : '') + (lines.length ? lines.join('\n') + more : empty))
      .setFooter({ text: 'Sanctions faites à la main dans Discord : 45 derniers jours seulement (journal d’audit).' })
      .setTimestamp();
    if (user) {
      const banned = await guild.bans.fetch(user.id).catch(() => null);
      const member = await guild.members.fetch(user.id).catch(() => null);
      const status = banned
        ? '🔨 Banni'
        : member?.isCommunicationDisabled()
          ? `🔇 Mute jusqu’à <t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:t>`
          : member
            ? '✅ Sur le serveur'
            : '👋 Plus sur le serveur';
      embed.addFields({ name: 'Statut', value: status, inline: true });
    }
    embed.addFields({
      name: 'Total',
      value: `⚠️ ${count('warn')} · 🔇 ${count('mute')} · 👢 ${count('kick')} · 🔨 ${count('ban', 'softban')}${count('derank') ? ` · 📉 ${count('derank')}` : ''}`,
      inline: true,
    });
    return interaction.editReply({ embeds: [embed] });
  },
};
