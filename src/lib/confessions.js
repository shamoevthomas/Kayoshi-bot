import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { getConfessionConfig, nextConfessionNumber } from './store.js';

// Confessions anonymes (/configconfessions) : un formulaire (texte et/ou image) publie la
// confession dans le salon configuré, sans dire aux membres qui l'a écrite. Sous chaque confession :
// « Soumettre une confession ! » et « Répondre » (réponse anonyme dans un fil sous la confession).
// L'auteur de chaque confession et réponse est envoyé dans le salon des logs (staff).

const COLOR = 0x97bfa6;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // limite d'envoi d'un bot sur un serveur sans boost

const submitButton = () =>
  new ButtonBuilder().setCustomId('conf_submit').setLabel('Soumettre une confession !').setStyle(ButtonStyle.Primary);

function confessionButtons() {
  return new ActionRowBuilder().addComponents(
    submitButton(),
    new ButtonBuilder().setCustomId('conf_reply').setLabel('Répondre').setStyle(ButtonStyle.Secondary),
  );
}

// Message publié par /configconfessions dans le salon : de quoi envoyer la première confession.
export function confessionPanel() {
  return {
    embeds: [
      new EmbedBuilder()
        .setColor(COLOR)
        .setTitle('💌 Confessions anonymes')
        .setDescription(
          'Clique sur le bouton ci-dessous pour envoyer une confession **anonyme** (texte et/ou image). ' +
            'Les membres ne sauront pas que c’est toi ; seul le staff peut voir l’auteur, en cas d’abus.',
        ),
    ],
    components: [new ActionRowBuilder().addComponents(submitButton())],
  };
}

// Formulaire commun aux confessions et aux réponses : un texte et une image, tous deux facultatifs
// (mais au moins l'un des deux).
function formModal(customId, title, textLabel) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(textLabel)
        .setDescription('Facultatif si tu ajoutes une image')
        .setTextInputComponent(new TextInputBuilder().setCustomId('text').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(4000)),
      new LabelBuilder()
        .setLabel('Image (facultatif)')
        .setFileUploadComponent(new FileUploadBuilder().setCustomId('image').setRequired(false).setMaxValues(1)),
    );
}

// Lit le formulaire. L'image envoyée dans un formulaire n'a qu'un lien temporaire :
// on la télécharge pour la republier en pièce jointe du message.
async function readForm(interaction) {
  const text = interaction.fields.getTextInputValue('text')?.trim() ?? '';
  const file = interaction.fields.getUploadedFiles('image')?.first() ?? null;
  if (!text && !file) return { error: 'Écris un texte ou ajoute une image.' };
  if (!file) return { text, image: null };
  if (!file.contentType?.startsWith('image/')) return { error: 'Le fichier doit être une image.' };
  if (file.size > MAX_IMAGE_BYTES) return { error: 'Image trop lourde (10 Mo maximum).' };
  const res = await fetch(file.url).catch(() => null);
  if (!res?.ok) return { error: 'Impossible de récupérer l’image, réessaie.' };
  const ext = (file.name?.match(/\.(png|jpe?g|gif|webp)$/i)?.[1] ?? 'png').toLowerCase();
  return { text, image: { buffer: Buffer.from(await res.arrayBuffer()), name: `image.${ext}` } };
}

function buildPost(title, { text, image }, components) {
  const embed = new EmbedBuilder().setColor(COLOR).setTitle(title);
  if (text) embed.setDescription(`"${text}"`);
  const files = [];
  if (image) {
    files.push(new AttachmentBuilder(image.buffer, { name: image.name }));
    embed.setImage(`attachment://${image.name}`);
  }
  return { embeds: [embed], files, components, allowedMentions: { parse: [] } };
}

// Log staff : qui a écrit quoi, avec le lien vers le message publié.
async function logConfession(interaction, title, form, url) {
  const { guild, user } = interaction;
  const logChannelId = getConfessionConfig(guild.id)?.logChannelId;
  const channel = logChannelId && (guild.channels.cache.get(logChannelId) ?? (await guild.channels.fetch(logChannelId).catch(() => null)));
  if (!channel?.isTextBased?.()) return;
  const embed = new EmbedBuilder()
    .setColor(COLOR)
    .setTitle(title)
    .setURL(url)
    .addFields({ name: 'Auteur', value: `${user} (${user.tag} · \`${user.id}\`)` })
    .setTimestamp();
  if (form.text) embed.setDescription(form.text);
  const files = [];
  if (form.image) {
    files.push(new AttachmentBuilder(form.image.buffer, { name: form.image.name }));
    embed.setImage(`attachment://${form.image.name}`);
  }
  await channel.send({ embeds: [embed], files, allowedMentions: { parse: [] } }).catch((err) => {
    console.error('[confessions] log impossible :', err.message);
  });
}

async function submitConfession(interaction) {
  await interaction.deferReply({ ephemeral: true });
  const { guild } = interaction;
  const channelId = getConfessionConfig(guild.id)?.channelId;
  const channel = channelId && (guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null)));
  if (!channel?.isTextBased?.()) {
    return interaction.editReply('❌ Le salon des confessions n’est pas configuré (ou a été supprimé). Un admin doit refaire `/configconfessions`.');
  }
  const form = await readForm(interaction);
  if (form.error) return interaction.editReply(`❌ ${form.error}`);

  const number = nextConfessionNumber(guild.id);
  const sent = await channel.send(buildPost(`Confession anonyme (#${number})`, form, [confessionButtons()])).catch((err) => {
    console.error('[confessions] publication impossible :', err.message);
    return null;
  });
  if (!sent) return interaction.editReply('❌ Je n’ai pas pu publier la confession (permissions du salon ?).');
  await logConfession(interaction, `📝 Confession #${number}`, form, sent.url);
  return interaction.editReply(`✅ Ta confession anonyme est publiée : ${sent.url}`);
}

// Réponse anonyme : publiée dans le fil de la confession (créé à la première réponse).
async function submitReply(interaction, messageId) {
  await interaction.deferReply({ ephemeral: true });
  const form = await readForm(interaction);
  if (form.error) return interaction.editReply(`❌ ${form.error}`);

  const channel = interaction.channel;
  const confession = await channel.messages.fetch(messageId).catch(() => null);
  if (!confession) return interaction.editReply('❌ Cette confession n’existe plus.');
  const number = confession.embeds[0]?.title?.match(/#(\d+)/)?.[1];
  // Le fil d'un message porte l'id du message : on le retrouve même s'il est archivé.
  const thread =
    confession.thread ??
    (await channel.threads.fetch(confession.id).catch(() => null)) ??
    (await confession
      .startThread({ name: `Réponses à la confession${number ? ` #${number}` : ''}`, autoArchiveDuration: 1440 })
      .catch(() => null));
  if (!thread) return interaction.editReply('❌ Je n’ai pas pu ouvrir le fil des réponses (permissions du salon ?).');
  if (thread.archived) await thread.setArchived(false).catch(() => {});

  const sent = await thread.send(buildPost('Réponse anonyme', form, [])).catch((err) => {
    console.error('[confessions] réponse impossible :', err.message);
    return null;
  });
  if (!sent) return interaction.editReply('❌ Je n’ai pas pu publier ta réponse (permissions du fil ?).');
  await logConfession(interaction, `💬 Réponse à la confession${number ? ` #${number}` : ''}`, form, sent.url);
  return interaction.editReply(`✅ Ta réponse anonyme est publiée : ${sent.url}`);
}

// Boutons et formulaires « conf_… ».
export async function handleConfessionInteraction(interaction) {
  const [action, arg] = interaction.customId.split(':');
  if (action === 'conf_submit') return interaction.showModal(formModal('conf_modal', 'Confession anonyme', 'Ta confession'));
  if (action === 'conf_reply') {
    return interaction.showModal(formModal(`conf_replymodal:${interaction.message.id}`, 'Réponse anonyme', 'Ta réponse'));
  }
  if (action === 'conf_modal') return submitConfession(interaction);
  if (action === 'conf_replymodal') return submitReply(interaction, arg);
}
