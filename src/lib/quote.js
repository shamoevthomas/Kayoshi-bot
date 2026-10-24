import { ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, MessageReferenceType, PermissionFlagsBits } from 'discord.js';
import { createCanvas } from '@napi-rs/canvas';
import { font, fetchImage } from './fonts.js';

// Citation en image (comme « Make it a Quote ») : répondre à un message en mentionnant le bot.
// Avatar de l'auteur à gauche (noir et blanc, fondu dans le fond), texte centré à droite.
// Boutons : thème clair/sombre, avatar en couleur, texte en gras ou en serif gras, supprimer.

const W = 1200;
const H = 630;
const TEXT_LEFT = 620;
const TEXT_RIGHT = 1150;
const THEMES = {
  dark: { bg: '#000000', text: '#ffffff', author: '#d9d9d9', muted: '#8a8a8a' },
  light: { bg: '#ffffff', text: '#111111', author: '#333333', muted: '#777777' },
};

// État des options, gardé dans les boutons : l = clair, c = couleur, b = gras, s = serif gras.
const parseFlags = (flags) => ({
  light: flags.includes('l'),
  color: flags.includes('c'),
  bold: flags.includes('b'),
  serif: flags.includes('s'),
});
const flagString = (s) => `${s.light ? 'l' : ''}${s.color ? 'c' : ''}${s.bold ? 'b' : ''}${s.serif ? 's' : ''}` || '-';
// Police du texte cité : normale, gras, ou serif (toujours en gras).
const textFont = (size, state) => font(size, { bold: state.bold || state.serif, serif: state.serif });

// Texte cité : mentions remplacées par les noms, emojis personnalisés par :nom:.
function quoteText(message) {
  return message.cleanContent.replace(/<a?:(\w+):\d+>/g, ':$1:').trim();
}

// Coupe le texte en lignes de largeur maximale (un mot trop long est coupé lui aussi).
function wrap(ctx, text, maxWidth) {
  const lines = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let chars = [...word];
      while (ctx.measureText(chars.join('')).width > maxWidth) {
        let i = chars.length - 1;
        while (i > 1 && ctx.measureText(chars.slice(0, i).join('')).width > maxWidth) i--;
        if (line) lines.push(line);
        lines.push(chars.slice(0, i).join(''));
        line = '';
        chars = chars.slice(i);
      }
      const piece = chars.join('');
      const test = line ? `${line} ${piece}` : piece;
      if (ctx.measureText(test).width <= maxWidth) line = test;
      else {
        lines.push(line);
        line = piece;
      }
    }
    lines.push(line);
  }
  return lines;
}

// Plus grande taille de police où tout le texte tient ; sinon taille minimale et texte coupé « … ».
function fitText(ctx, text, state, maxWidth, maxHeight) {
  let size = 64;
  let lines;
  for (; size >= 24; size -= 2) {
    ctx.font = textFont(size, state);
    lines = wrap(ctx, text, maxWidth);
    if (lines.length * size * 1.25 <= maxHeight) return { size, lines };
  }
  size = 24;
  ctx.font = textFont(size, state);
  lines = lines.slice(0, Math.floor(maxHeight / (size * 1.25)));
  let last = [...lines.at(-1)];
  while (last.length && ctx.measureText(`${last.join('')}…`).width > maxWidth) last.pop();
  lines[lines.length - 1] = `${last.join('')}…`;
  return { size, lines };
}

async function renderQuote(message, state) {
  const theme = state.light ? THEMES.light : THEMES.dark;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, W, H);

  // Avatar sur toute la hauteur à gauche, puis fondu vers la couleur du fond.
  const author = message.member ?? message.author;
  const avatar = await fetchImage(author.displayAvatarURL({ extension: 'png', size: 1024, forceStatic: true }));
  if (avatar) {
    if (!state.color) ctx.filter = 'grayscale(1)';
    ctx.drawImage(avatar, 0, 0, H, H);
    ctx.filter = 'none';
  }
  const fade = ctx.createLinearGradient(H * 0.55, 0, H, 0);
  fade.addColorStop(0, `${theme.bg}00`);
  fade.addColorStop(1, theme.bg);
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, H + 1, H);

  // Texte, puis « - Nom » et « @pseudo », le tout centré verticalement.
  const cx = (TEXT_LEFT + TEXT_RIGHT) / 2;
  const { size, lines } = fitText(ctx, quoteText(message), state, TEXT_RIGHT - TEXT_LEFT, H - 250);
  const lineHeight = size * 1.25;
  const blockHeight = lines.length * lineHeight + 24 + 34 + 30;
  let y = (H - blockHeight) / 2 + lineHeight / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = theme.text;
  ctx.font = textFont(size, state);
  for (const line of lines) {
    ctx.fillText(line, cx, y, TEXT_RIGHT - TEXT_LEFT);
    y += lineHeight;
  }
  const name = message.member?.displayName ?? message.author.globalName ?? message.author.username;
  y += 24 - lineHeight / 2 + 17;
  ctx.font = font(30, { italic: true });
  ctx.fillStyle = theme.author;
  ctx.fillText(`- ${name}`, cx, y, TEXT_RIGHT - TEXT_LEFT);
  ctx.font = font(20);
  ctx.fillStyle = theme.muted;
  ctx.fillText(`@${message.author.username}`, cx, y + 32);

  // Signature en bas à droite.
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.font = font(18);
  ctx.fillText('Kayoshi', W - 22, H - 20);

  return new AttachmentBuilder(await canvas.encode('png'), { name: 'citation.png' });
}

function quoteButtons(state, messageId, requesterId) {
  const id = (action) => `qt_${action}:${flagString(state)}:${messageId}:${requesterId}`;
  // Option active = bouton bleu.
  const style = (on) => (on ? ButtonStyle.Primary : ButtonStyle.Secondary);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(id('light')).setEmoji('☀️').setStyle(style(state.light)),
    new ButtonBuilder().setCustomId(id('color')).setEmoji('🎨').setStyle(style(state.color)),
    new ButtonBuilder().setCustomId(id('bold')).setLabel('B').setStyle(style(state.bold)),
    new ButtonBuilder().setCustomId(id('serif')).setLabel('𝐒𝐞𝐫𝐢𝐟').setStyle(style(state.serif)),
    new ButtonBuilder().setCustomId(id('del')).setEmoji('🗑️').setLabel('Supprimer').setStyle(ButtonStyle.Secondary),
  );
}

// Message qui répond à un autre en mentionnant le bot → citation du message visé.
export async function handleQuoteCommand(message) {
  if (!message.guild || message.author.bot || !message.reference?.messageId) return false;
  if (message.reference.type === MessageReferenceType.Forward) return false;
  // Mention écrite dans le message : le bot, ou son rôle (« @Kayoshi » propose les deux).
  // La mention automatique d'une réponse à un message du bot ne compte pas.
  // (Le rôle est lu dans le texte : un rôle non mentionnable n'apparaît pas dans message.mentions.)
  const botId = message.client.user.id;
  const botRoleId = message.guild.members.me?.roles.botRole?.id;
  const mentioned =
    new RegExp(`<@!?${botId}>`).test(message.content) || Boolean(botRoleId && message.content.includes(`<@&${botRoleId}>`));
  if (!mentioned) return false;
  const answer = (content) => message.reply({ content, allowedMentions: { repliedUser: false } }).catch(() => {});
  const original = await message.fetchReference().catch(() => null);
  if (!original) {
    await answer('❌ Je n’arrive pas à lire le message auquel tu réponds.');
    return true;
  }
  if (!quoteText(original)) {
    await answer('❌ Ce message n’a pas de texte à citer.');
    return true;
  }
  const state = { light: false, color: false, bold: false, serif: false };
  const image = await renderQuote(original, state).catch((err) => {
    console.error('[quote] image impossible :', err);
    return null;
  });
  if (!image) {
    await answer('❌ Je n’ai pas réussi à créer la citation.');
    return true;
  }
  await message
    .reply({ files: [image], components: [quoteButtons(state, original.id, message.author.id)], allowedMentions: { repliedUser: false } })
    .catch(async (err) => {
      console.error('[quote] envoi impossible :', err.message);
      await answer('❌ Je n’ai pas pu envoyer la citation ici (il me faut la permission **Joindre des fichiers**).');
    });
  return true;
}

// Boutons « qt_… » : réservés à la personne qui a demandé la citation, à l'auteur du message
// cité et aux modérateurs (Gérer les messages).
export async function handleQuoteInteraction(interaction) {
  const [head, flags, messageId, requesterId] = interaction.customId.split(':');
  const action = head.slice('qt_'.length);
  const original = await interaction.channel.messages.fetch(messageId).catch(() => null);
  const allowed =
    interaction.user.id === requesterId ||
    interaction.user.id === original?.author.id ||
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
  if (!allowed) {
    return interaction.reply({ content: '❌ Seuls la personne qui a demandé la citation et l’auteur du message peuvent y toucher.', ephemeral: true });
  }
  if (action === 'del') {
    await interaction.deferUpdate().catch(() => {});
    return interaction.message.delete().catch(() => {});
  }
  if (!original) return interaction.reply({ content: '❌ Le message cité n’existe plus.', ephemeral: true });

  const state = parseFlags(flags);
  if (!(action in state)) return;
  state[action] = !state[action];
  // Gras et serif gras s'excluent : activer l'un désactive l'autre.
  if (action === 'bold' && state.bold) state.serif = false;
  if (action === 'serif' && state.serif) state.bold = false;
  await interaction.deferUpdate();
  const image = await renderQuote(original, state);
  await interaction.editReply({ files: [image], attachments: [], components: [quoteButtons(state, messageId, requesterId)] });
}
