import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  UserSelectMenuBuilder,
} from 'discord.js';
import { createCanvas } from '@napi-rs/canvas';
import { font, fetchImage } from './fonts.js';

// Calculateur d'amour / de haine / d'amitié, comme le bot Koya :
//   ^^lc (amour), ^^hc (haine), ^^fc (amitié), suivis de « random », d'un ou de deux membres.
// Le pourcentage est tiré au hasard à chaque fois. Les boutons sous le message (réservés
// à l'auteur de la commande) gardent leur état dans leur id :
//   lc_<action>:<mode>:<auteur>:<membre 1>:<membre 2>

const COMMAND = /^\^\^([lhf])c(?:\s+(.*))?$/i;
const MODES = {
  love: {
    letter: 'l',
    label: 'Amour',
    emoji: '❤️',
    of: 'd’amour',
    colors: ['#2ee6d6', '#f3f08a'],
    shape: ['#ff4d7d', '#ff9ab8'],
    phrases: [
      'Aucune étincelle entre **{a}** et **{b}**… peut-être dans une autre vie',
      'Entre **{a}** et **{b}**, c’est plutôt glacial',
      '**{a}** et **{b}**, c’est compliqué… mais pas impossible',
      'Il se passe clairement quelque chose entre **{a}** et **{b}**',
      'La connexion entre **{a}** et **{b}** est une pure énergie réconfortante',
      '**{a}** et **{b}** sont faits l’un pour l’autre',
    ],
    decor: '💖',
  },
  hate: {
    letter: 'h',
    label: 'Haine',
    emoji: '💔',
    of: 'de haine',
    colors: ['#3a0d12', '#a3243c'],
    shape: ['#5c0a1c', '#d63a55'],
    phrases: [
      '**{a}** et **{b}** s’entendent à merveille, aucune haine ici',
      'Quelques petites tensions entre **{a}** et **{b}**',
      'Entre **{a}** et **{b}**, l’ambiance est électrique',
      '**{a}** et **{b}** ont du mal à se supporter',
      '**{a}** et **{b}** ne peuvent pas se voir',
      '**{a}** et **{b}** sont des ennemis jurés',
    ],
    decor: '💢',
  },
  friendship: {
    letter: 'f',
    label: 'Amitié',
    emoji: '⭐',
    of: 'd’amitié',
    colors: ['#4facfe', '#a6f77b'],
    shape: ['#ffb703', '#ffe066'],
    phrases: [
      '**{a}** et **{b}** se connaissent à peine',
      '**{a}** et **{b}**, de simples connaissances',
      '**{a}** et **{b}** s’entendent plutôt bien',
      '**{a}** et **{b}** forment une sacrée équipe',
      'L’amitié entre **{a}** et **{b}** est solide comme un roc',
      '**{a}** et **{b}** sont inséparables',
    ],
    decor: '🤝',
  },
};
const MODE_BY_LETTER = Object.fromEntries(Object.entries(MODES).map(([mode, m]) => [m.letter, mode]));

// --- Image ---

function heartPath(ctx, cx, cy, size) {
  const s = size / 2;
  ctx.beginPath();
  ctx.moveTo(cx, cy + s * 0.85);
  ctx.bezierCurveTo(cx - s * 1.25, cy - s * 0.05, cx - s * 0.75, cy - s * 1.05, cx, cy - s * 0.45);
  ctx.bezierCurveTo(cx + s * 0.75, cy - s * 1.05, cx + s * 1.25, cy - s * 0.05, cx, cy + s * 0.85);
  ctx.closePath();
}

function starPath(ctx, cx, cy, size) {
  const outer = size / 2;
  const inner = outer * 0.48;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    ctx.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  ctx.closePath();
}

function avatar(ctx, img, cx, cy, size, fallback) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.25)';
  ctx.shadowBlur = 18;
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2 + 10, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  ctx.clip();
  if (img) ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
  else {
    ctx.fillStyle = '#4e5058';
    ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
    ctx.font = font(size * 0.42, { bold: true });
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText([...fallback][0]?.toUpperCase() ?? '?', cx, cy);
  }
  ctx.restore();
}

async function renderCard(mode, userA, userB, percent) {
  const m = MODES[mode];
  const W = 1000;
  const H = 340;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const [imgA, imgB] = await Promise.all([
    fetchImage(userA.displayAvatarURL({ extension: 'png', size: 256 })),
    fetchImage(userB.displayAvatarURL({ extension: 'png', size: 256 })),
  ]);

  // Fond dégradé + panneau translucide.
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, m.colors[0]);
  bg.addColorStop(1, m.colors[1]);
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, 26);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(36, 30, W - 72, H - 60, 28);
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();

  avatar(ctx, imgA, 210, H / 2, 210, userA.username);
  avatar(ctx, imgB, W - 210, H / 2, 210, userB.username);

  // Cœur (amour), cœur brisé (haine) ou étoile (amitié), avec le pourcentage.
  const cx = W / 2;
  const cy = H / 2 + 6;
  const shape = ctx.createLinearGradient(cx, cy - 120, cx, cy + 120);
  shape.addColorStop(0, m.shape[1]);
  shape.addColorStop(1, m.shape[0]);
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 20;
  if (mode === 'friendship') starPath(ctx, cx, cy + 10, 280);
  else heartPath(ctx, cx, cy - 6, 250);
  ctx.fillStyle = shape;
  ctx.fill();
  ctx.restore();
  if (mode === 'hate') {
    // Fissure du cœur brisé.
    ctx.beginPath();
    ctx.moveTo(cx + 4, cy - 64);
    ctx.lineTo(cx - 14, cy - 28);
    ctx.lineTo(cx + 12, cy - 4);
    ctx.lineTo(cx - 10, cy + 30);
    ctx.lineTo(cx + 6, cy + 70);
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 6;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 8;
  const isStar = mode === 'friendship';
  const ty = isStar ? cy + 24 : cy - 4;
  ctx.font = font(isStar ? 48 : 66, { bold: true });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (isStar) {
    // Contour pour rester lisible sur le jaune de l'étoile.
    ctx.strokeStyle = 'rgba(150,80,0,0.6)';
    ctx.lineWidth = 7;
    ctx.lineJoin = 'round';
    ctx.strokeText(`${percent}%`, cx, ty);
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${percent}%`, cx, ty);
  ctx.restore();

  return canvas.encode('png');
}

// --- Message ---

const nameOf = (guild, user) => guild.members.cache.get(user.id)?.displayName ?? user.globalName ?? user.username;
const clean = (name) => name.replace(/[*_~`|\\]/g, '');

function buttons(mode, authorId, a, b) {
  const state = `${mode}:${authorId}:${a}:${b}`;
  const others = Object.entries(MODES).filter(([key]) => key !== mode);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`lc_rand:${state}`).setLabel('Aléatoire').setStyle(ButtonStyle.Secondary).setEmoji('🎲'),
    new ButtonBuilder().setCustomId(`lc_user:${state}`).setLabel('Changer de membre').setStyle(ButtonStyle.Secondary).setEmoji('👥'),
    ...others.map(([key, m]) =>
      new ButtonBuilder().setCustomId(`lc_mode:${key}:${authorId}:${a}:${b}`).setLabel(m.label).setStyle(ButtonStyle.Secondary).setEmoji(m.emoji),
    ),
  );
}

async function resultPayload(guild, mode, authorId, userA, userB) {
  const m = MODES[mode];
  const percent = Math.floor(Math.random() * 101);
  const phrase = m.phrases[Math.min(m.phrases.length - 1, Math.floor(percent / (101 / m.phrases.length)))]
    .replace('{a}', clean(nameOf(guild, userA)))
    .replace('{b}', clean(nameOf(guild, userB)));
  const png = await renderCard(mode, userA, userB, percent);
  return {
    content: `${userA} + ${userB} = **${percent}%** ${m.of} ${m.emoji}\n${m.decor} ${phrase} ${m.decor}`,
    files: [new AttachmentBuilder(png, { name: 'lovecalc.png' })],
    attachments: [],
    components: [buttons(mode, authorId, userA.id, userB.id)],
    allowedMentions: { parse: [] },
  };
}

// Membre au hasard du serveur (humain, différent de ceux à exclure).
async function randomMember(guild, excludeIds) {
  const pick = () => guild.members.cache.filter((mem) => !mem.user.bot && !excludeIds.includes(mem.id));
  let pool = pick();
  if (pool.size < 5) {
    await guild.members.fetch().catch(() => null);
    pool = pick();
  }
  return pool.random()?.user ?? null;
}

async function resolveUser(client, token) {
  const id = token.match(/^<@!?(\d{17,20})>$/)?.[1] ?? token.match(/^\d{17,20}$/)?.[0];
  return id ? client.users.fetch(id).catch(() => null) : null;
}

// --- Commandes en message ---

export async function handleLoveCommand(message) {
  if (!message.guild || message.author.bot) return false;
  const match = message.content.trim().match(COMMAND);
  if (!match) return false;
  const mode = MODE_BY_LETTER[match[1].toLowerCase()];
  const args = (match[2] ?? '').trim().split(/\s+/).filter(Boolean);

  // ^^lc / ^^lc random → toi + quelqu'un au hasard ; ^^lc @a → toi + a ; ^^lc @a @b → a + b.
  let userA = message.author;
  let userB = null;
  const named = [];
  for (const token of args.filter((t) => t.toLowerCase() !== 'random').slice(0, 2)) {
    const user = await resolveUser(message.client, token);
    if (!user) {
      await message
        .reply({ content: `❌ Membre introuvable : \`${token}\`. Mentionne-le (\`^^${match[1]}c @membre\`) ou donne son ID.`, allowedMentions: { repliedUser: false } })
        .catch(() => {});
      return true;
    }
    named.push(user);
  }
  if (named.length === 2) [userA, userB] = named;
  else if (named.length === 1) userB = named[0];
  else userB = await randomMember(message.guild, [message.author.id]);
  if (!userB) {
    await message.reply({ content: '❌ Je n’ai trouvé personne d’autre sur le serveur.', allowedMentions: { repliedUser: false } }).catch(() => {});
    return true;
  }

  await message.channel.sendTyping().catch(() => {});
  const payload = await resultPayload(message.guild, mode, message.author.id, userA, userB);
  delete payload.attachments;
  await message.reply({ ...payload, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
  return true;
}

// --- Boutons et menu (préfixe « lc_ ») ---

export async function handleLoveInteraction(interaction) {
  const [action, mode, authorId, a, b] = interaction.customId.split(':');
  if (!MODES[mode]) return;
  if (interaction.user.id !== authorId) {
    return interaction.reply({ content: '❌ Ces boutons sont réservés à la personne qui a lancé la commande. Lance la tienne avec `^^lc` !', ephemeral: true });
  }
  const { guild, client } = interaction;
  const fetchUser = (id) => client.users.fetch(id).catch(() => null);

  // Changer de membre : menu de sélection à la place des boutons (1 membre = remplace le 2ᵉ, 2 = les deux).
  if (interaction.isButton() && action === 'lc_user') {
    return interaction.update({
      components: [
        new ActionRowBuilder().addComponents(
          new UserSelectMenuBuilder()
            .setCustomId(`lc_pick:${mode}:${authorId}:${a}:${b}`)
            .setPlaceholder('Choisis 1 membre (à la place du 2ᵉ) ou 2 membres')
            .setMinValues(1)
            .setMaxValues(2),
        ),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`lc_back:${mode}:${authorId}:${a}:${b}`).setLabel('Annuler').setStyle(ButtonStyle.Secondary),
        ),
      ],
    });
  }

  if (interaction.isButton() && action === 'lc_back') {
    return interaction.update({ components: [buttons(mode, authorId, a, b)] });
  }

  let pair;
  if (interaction.isUserSelectMenu() && action === 'lc_pick') {
    const picked = [...interaction.users.values()];
    pair = picked.length === 2 ? picked : [await fetchUser(a), picked[0]];
  } else if (interaction.isButton() && action === 'lc_rand') {
    // Aléatoire : garde le 1ᵉʳ membre, tire un nouveau 2ᵉ au hasard.
    pair = [await fetchUser(a), await randomMember(guild, [a, b])];
  } else if (interaction.isButton() && action === 'lc_mode') {
    pair = [await fetchUser(a), await fetchUser(b)];
  } else return;

  if (!pair[0] || !pair[1]) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });
  await interaction.deferUpdate();
  const payload = await resultPayload(guild, mode, authorId, pair[0], pair[1]);
  await interaction.editReply(payload).catch(() => {});
}
