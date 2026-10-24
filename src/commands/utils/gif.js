import { SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { imageToGif } from '../../lib/togif.js';

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_GIF_BYTES = 10 * 1024 * 1024; // limite d'envoi d'un bot sur un serveur sans boost

// Lien vers une adresse locale ou privée (réseau de l'hébergeur) : refusé.
function isPrivateHost(hostname) {
  return /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|\[?f[cd])/i.test(hostname);
}

export default {
  data: new SlashCommandBuilder()
    .setName('gif')
    .setDescription('Transformer une image en GIF (fichier ou lien), pour l’ajouter à tes GIF favoris.')
    .addAttachmentOption((o) => o.setName('image').setDescription('L’image à transformer'))
    .addStringOption((o) => o.setName('lien').setDescription('Ou un lien direct vers une image (png, jpg, webp…)'))
    .setDMPermission(false),

  async execute(interaction) {
    const attachment = interaction.options.getAttachment('image');
    const link = interaction.options.getString('lien')?.trim();
    if (!attachment && !link) {
      return interaction.reply({ content: '❌ Ajoute une image (`image`) ou un lien vers une image (`lien`).', ephemeral: true });
    }
    let url = attachment?.url;
    if (!url) {
      let parsed = null;
      try {
        parsed = new URL(link);
      } catch {}
      if (!parsed || !/^https?:$/.test(parsed.protocol) || isPrivateHost(parsed.hostname)) {
        return interaction.reply({ content: '❌ Ce lien n’est pas valide (il doit commencer par `http://` ou `https://`).', ephemeral: true });
      }
      url = parsed.href;
    }

    await interaction.deferReply();
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!res?.ok) return interaction.editReply('❌ Impossible de récupérer l’image.');
    const type = (res.headers.get('content-type') ?? attachment?.contentType ?? '').toLowerCase();
    if (!type.startsWith('image/')) {
      return interaction.editReply('❌ Ce n’est pas une image : le lien doit mener directement à une image (png, jpg, webp…).');
    }
    if (Number(res.headers.get('content-length') ?? 0) > MAX_SOURCE_BYTES) return interaction.editReply('❌ Image trop lourde (20 Mo maximum).');
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length > MAX_SOURCE_BYTES) return interaction.editReply('❌ Image trop lourde (20 Mo maximum).');

    // Déjà un GIF : renvoyé tel quel (animation gardée).
    const gif = type.startsWith('image/gif') ? buffer : await imageToGif(buffer).catch(() => null);
    if (!gif) return interaction.editReply('❌ Je n’arrive pas à lire cette image.');
    if (gif.length > MAX_GIF_BYTES) return interaction.editReply('❌ Le GIF obtenu dépasse 10 Mo, essaie avec une image plus petite.');
    await interaction.editReply({ files: [new AttachmentBuilder(gif, { name: 'image.gif' })] });
  },
};
