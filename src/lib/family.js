import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { createCanvas } from '@napi-rs/canvas';
import { font, fetchImage } from './fonts.js';
import { getRelations, marry, divorce, adopt, removeAdoption, getFamily } from './store.js';

// Famille virtuelle : /marry (mariage), /divorce, /adopt (adoption), /family (arbre en image).
// Les demandes de mariage et d'adoption attendent l'accord du membre visé (boutons).

const PROPOSE_TIMEOUT = 5 * 60_000;

// --- Vérifications ---

// Ancêtres adoptifs d'un membre (parent, grand-parent…) : évite les boucles d'adoption.
function ancestors(guildId, userId) {
  const out = new Set();
  let current = getRelations(guildId, userId).parent;
  while (current && !out.has(current)) {
    out.add(current);
    current = getRelations(guildId, current).parent;
  }
  return out;
}

// Raison de refus d'une demande de mariage (null si c'est bon).
export function marriageProblem(guildId, proposerId, targetId, target) {
  if (target.bot) return 'On ne peut pas se marier avec un bot.';
  if (proposerId === targetId) return 'Tu ne peux pas te marier avec toi-même.';
  const me = getRelations(guildId, proposerId);
  if (me.spouse) return me.spouse === targetId ? 'Vous êtes déjà mariés tous les deux.' : 'Tu es déjà marié(e). Fais `/divorce` d’abord.';
  if (getRelations(guildId, targetId).spouse) return 'Cette personne est déjà mariée.';
  if (me.parent === targetId || me.children.includes(targetId)) return 'On ne peut pas se marier avec son parent ou son enfant adoptif.';
  return null;
}

// Raison de refus d'une demande d'adoption (null si c'est bon).
export function adoptionProblem(guildId, parentId, childId, child) {
  if (child.bot) return 'On ne peut pas adopter un bot.';
  if (parentId === childId) return 'Tu ne peux pas t’adopter toi-même.';
  const childRel = getRelations(guildId, childId);
  if (childRel.parent) return childRel.parent === parentId ? 'Tu as déjà adopté cette personne.' : 'Cette personne a déjà un parent adoptif.';
  if (getRelations(guildId, parentId).spouse === childId) return 'On ne peut pas adopter son conjoint.';
  if (ancestors(guildId, parentId).has(childId)) return 'On ne peut pas adopter un de ses parents ou grands-parents.';
  return null;
}

// --- Demandes (boutons) ---

const KINDS = {
  marry: { verb: 'épouser', question: (p, t) => `💍 ${p} demande ${t} en mariage !`, accept: 'Accepter 💕', refuse: 'Refuser 💔', emoji: '💍' },
  adopt: { verb: 'adopter', question: (p, t) => `🍼 ${p} veut adopter ${t} !`, accept: 'Accepter 🤗', refuse: 'Refuser', emoji: '🍼' },
};

async function propose(interaction, kind, proposer, target, problem) {
  if (problem) return interaction.reply({ content: `❌ ${problem}`, ephemeral: true });
  const k = KINDS[kind];
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`fam_ok:${kind}:${proposer.id}:${target.id}`).setLabel(k.accept).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`fam_no:${kind}:${proposer.id}:${target.id}`).setLabel(k.refuse).setStyle(ButtonStyle.Danger),
  );
  const message = await interaction.reply({
    content: `${target}, ${k.question(`**${proposer.displayName ?? proposer.username}**`, `**${target.displayName ?? target.username}**`)}\n-# Seul(e) ${target} peut répondre · expire dans 5 min`,
    components: [row],
    allowedMentions: { users: [target.id] },
    fetchReply: true,
  });
  // Au bout de 5 min sans réponse : boutons retirés.
  setTimeout(() => {
    message.edit({ components: [] }).catch(() => {});
  }, PROPOSE_TIMEOUT);
  return message;
}

export async function proposeMarriage(interaction, target) {
  const { guild } = interaction;
  return propose(interaction, 'marry', interaction.member, target, marriageProblem(guild.id, interaction.user.id, target.id, target.user));
}

export async function proposeAdoption(interaction, target) {
  const { guild } = interaction;
  return propose(interaction, 'adopt', interaction.member, target, adoptionProblem(guild.id, interaction.user.id, target.id, target.user));
}

// Réponse à une demande (boutons « fam_ok » / « fam_no »).
export async function handleFamilyInteraction(interaction) {
  const [action, kind, proposerId, targetId] = interaction.customId.split(':');
  if (interaction.user.id !== targetId) {
    return interaction.reply({ content: '❌ Seule la personne concernée peut répondre à cette demande.', ephemeral: true });
  }
  const k = KINDS[kind];
  const proposer = await interaction.client.users.fetch(proposerId).catch(() => null);

  if (action === 'fam_no') {
    return interaction.update({ content: `💔 ${interaction.user} a refusé la demande${proposer ? ` de ${proposer}` : ''}.`, components: [], allowedMentions: { parse: [] } });
  }

  // Accord : on revérifie (la situation a pu changer depuis la demande).
  const guildId = interaction.guild.id;
  const problem = kind === 'marry'
    ? marriageProblem(guildId, proposerId, targetId, interaction.user)
    : adoptionProblem(guildId, proposerId, targetId, interaction.user);
  if (problem) return interaction.update({ content: `❌ ${problem}`, components: [] });

  if (kind === 'marry') {
    marry(guildId, proposerId, targetId);
    return interaction.update({ content: `💍 Félicitations ${proposer ?? `<@${proposerId}>`} et ${interaction.user}, vous êtes maintenant **mariés** ! 🎉`, components: [], allowedMentions: { parse: [] } });
  }
  adopt(guildId, proposerId, targetId);
  return interaction.update({ content: `🍼 ${proposer ?? `<@${proposerId}>`} a adopté ${interaction.user} ! Bienvenue dans la famille 🤗`, components: [], allowedMentions: { parse: [] } });
}

// --- Image de l'arbre (/family) ---

const C = { bg: '#313338', panel: '#232428', text: '#f2f3f5', muted: '#b5bac1', line: '#4e5058', heart: '#ff4d7d', ring: '#5865f2' };

async function avatarNode(ctx, user, member, cx, cy, size, label, ringColor) {
  const img = await fetchImage((member ?? user).displayAvatarURL({ extension: 'png', size: 128 }));
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 + 4, 0, Math.PI * 2);
  ctx.fillStyle = ringColor;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.clip();
  if (img) ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  else {
    ctx.fillStyle = '#4e5058';
    ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
  }
  ctx.restore();
  const name = member?.displayName ?? user?.username ?? 'Inconnu';
  ctx.font = font(21, { bold: true });
  ctx.fillStyle = C.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name.length > 16 ? name.slice(0, 15) + '…' : name, cx, cy + size / 2 + 22);
  if (label) {
    ctx.font = font(17, { italic: true });
    ctx.fillStyle = C.muted;
    ctx.fillText(label, cx, cy + size / 2 + 44);
  }
}

function line(ctx, x1, y1, x2, y2) {
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

// Récupère membre + user pour un id (depuis le cache si possible).
async function resolve(guild, id) {
  const member = guild.members.cache.get(id) ?? (await guild.members.fetch(id).catch(() => null));
  const user = member?.user ?? (await guild.client.users.fetch(id).catch(() => null));
  return { member, user };
}

export async function renderFamilyCard(guild, userId) {
  const rel = getRelations(guild.id, userId);
  const AV = 96;
  const ROW = AV + 78; // avatar + ses deux lignes de texte + espace pour le trait
  const W = Math.max(640, 80 + Math.max(rel.children.length, rel.spouse ? 2 : 1) * 175);

  // Rangées empilées du haut vers le bas : parent (option) → couple → enfants (option).
  let cursor = 72; // sous le titre
  const parentY = rel.parent ? cursor + AV / 2 : null;
  if (rel.parent) cursor += ROW;
  const coupleY = cursor + AV / 2;
  cursor += ROW;
  const childY = rel.children.length ? cursor + AV / 2 : null;
  if (rel.children.length) cursor += ROW;
  const H = cursor + 6;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = C.bg;
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 24);
  ctx.fill();

  const { member: self, user: selfUser } = await resolve(guild, userId);
  ctx.font = font(28, { bold: true });
  ctx.fillStyle = C.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`Famille de ${self?.displayName ?? selfUser?.username ?? 'ce membre'}`, W / 2, 40);

  // Parent adoptif, relié au couple (trait tracé avant les avatars, donc derrière).
  if (rel.parent) {
    const { member, user } = await resolve(guild, rel.parent);
    line(ctx, W / 2, parentY + AV / 2, W / 2, coupleY - AV / 2);
    await avatarNode(ctx, user, member, W / 2, parentY, AV, 'Parent', C.line);
  }

  // Le membre, et son conjoint à côté (cœur entre les deux).
  if (rel.spouse) {
    const { member, user } = await resolve(guild, rel.spouse);
    const gap = 160;
    ctx.font = font(34);
    ctx.fillStyle = C.heart;
    ctx.fillText('💗', W / 2, coupleY);
    await avatarNode(ctx, selfUser, self, W / 2 - gap / 2, coupleY, AV, 'Toi', C.ring);
    await avatarNode(ctx, user, member, W / 2 + gap / 2, coupleY, AV, 'Marié(e)', C.heart);
  } else {
    await avatarNode(ctx, selfUser, self, W / 2, coupleY, AV, 'Célibataire', C.ring);
  }

  // Enfants adoptés, reliés au couple par un trait en T.
  if (rel.children.length) {
    const spacing = W / (rel.children.length + 1);
    const busY = childY - AV / 2 - 22;
    line(ctx, W / 2, coupleY + AV / 2, W / 2, busY);
    line(ctx, spacing, busY, W - spacing, busY);
    for (const [i, childId] of rel.children.entries()) {
      const x = spacing * (i + 1);
      const { member, user } = await resolve(guild, childId);
      line(ctx, x, busY, x, childY - AV / 2);
      await avatarNode(ctx, user, member, x, childY, AV, 'Enfant', C.line);
    }
  }

  return new AttachmentBuilder(await canvas.encode('png'), { name: 'famille.png' });
}

// Résumé texte des relations, pour l'embed de /family.
export function familySummary(guild, userId) {
  const rel = getRelations(guild.id, userId);
  const lines = [];
  if (rel.spouse) {
    const key = [userId, rel.spouse].sort().join('-');
    const since = rel.since[key];
    lines.push(`💍 Marié(e) à <@${rel.spouse}>${since ? ` depuis <t:${Math.floor(since / 1000)}:D>` : ''}`);
  } else lines.push('💍 Célibataire');
  if (rel.parent) lines.push(`👤 Parent : <@${rel.parent}>`);
  if (rel.children.length) lines.push(`🍼 Enfant(s) : ${rel.children.map((id) => `<@${id}>`).join(', ')}`);
  return new EmbedBuilder().setColor(0xeb459e).setDescription(lines.join('\n'));
}

export { removeAdoption, divorce, getFamily };
