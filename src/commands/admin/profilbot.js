import { SlashCommandBuilder, PermissionFlagsBits, RateLimitError } from 'discord.js';

// Profil du bot propre à ce serveur (photo, bannière, bio) : rien ne change sur les autres
// serveurs ni sur le profil global de Kayøshi.
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const LABELS = { avatar: 'photo de profil', banner: 'bannière', bio: 'bio' };

// Image d'une pièce jointe en data URI, avec son vrai type (discord.js marquerait tout en JPEG).
async function toDataUri(attachment) {
  const res = await fetch(attachment.url, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
  if (!res?.ok) return null;
  return `data:${attachment.contentType};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
}

export default {
  data: new SlashCommandBuilder()
    .setName('profilbot')
    .setDescription('Changer la photo, la bannière ou la bio du bot sur ce serveur uniquement.')
    .addSubcommand((s) =>
      s
        .setName('modifier')
        .setDescription('Changer la photo, la bannière et/ou la bio du bot sur ce serveur.')
        .addAttachmentOption((o) => o.setName('avatar').setDescription('Nouvelle photo de profil (image)'))
        .addAttachmentOption((o) => o.setName('banniere').setDescription('Nouvelle bannière (image)'))
        .addStringOption((o) => o.setName('bio').setDescription('Nouvelle bio (190 caractères max)').setMaxLength(190)),
    )
    .addSubcommand((s) =>
      s
        .setName('reinitialiser')
        .setDescription('Revenir au profil global du bot sur ce serveur.')
        .addStringOption((o) =>
          o
            .setName('element')
            .setDescription('Ce qu’il faut remettre comme sur le profil global')
            .setRequired(true)
            .addChoices(
              { name: 'Photo de profil', value: 'avatar' },
              { name: 'Bannière', value: 'banner' },
              { name: 'Bio', value: 'bio' },
              { name: 'Tout', value: 'all' },
            ),
        ),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const changes = {};

    if (sub === 'reinitialiser') {
      const element = interaction.options.getString('element');
      for (const key of element === 'all' ? ['avatar', 'banner', 'bio'] : [element]) changes[key] = null;
    } else {
      for (const [option, key] of [
        ['avatar', 'avatar'],
        ['banniere', 'banner'],
      ]) {
        const attachment = interaction.options.getAttachment(option);
        if (!attachment) continue;
        if (!attachment.contentType?.startsWith('image/')) {
          return interaction.reply({ content: `❌ \`${option}\` doit être une image (png, jpg, gif, webp).`, ephemeral: true });
        }
        if (attachment.size > MAX_IMAGE_BYTES) {
          return interaction.reply({ content: `❌ \`${option}\` est trop lourde (10 Mo maximum).`, ephemeral: true });
        }
        changes[key] = attachment;
      }
      const bio = interaction.options.getString('bio');
      if (bio !== null) changes.bio = bio;
      if (!Object.keys(changes).length) {
        return interaction.reply({ content: '❌ Donne au moins une photo (`avatar`), une bannière (`banniere`) ou une `bio`.', ephemeral: true });
      }
    }

    await interaction.deferReply({ ephemeral: true });
    for (const key of ['avatar', 'banner']) {
      if (!changes[key]) continue;
      changes[key] = await toDataUri(changes[key]);
      if (!changes[key]) return interaction.editReply('❌ Impossible de récupérer l’image, réessaie.');
    }

    try {
      await interaction.guild.members.editMe({ ...changes, reason: `/profilbot par ${interaction.user.tag}` });
    } catch (err) {
      // Longue attente imposée par Discord (voir rejectOnRateLimit dans index.js).
      if (err instanceof RateLimitError) {
        const minutes = Math.ceil(Math.max(err.retryAfter, err.timeToReset) / 60_000);
        return interaction.editReply(`⏸️ Discord limite les changements de profil : réessaie dans **${minutes} min** environ.`);
      }
      console.error('[profilbot]', err);
      return interaction.editReply(`❌ Discord a refusé le changement : ${err.message}`);
    }

    const what = Object.keys(changes).map((key) => LABELS[key]).join(', ');
    return interaction.editReply(
      sub === 'reinitialiser'
        ? `✅ Remis comme sur le profil global, sur ce serveur : ${what}.`
        : `✅ Profil du bot sur ce serveur mis à jour : ${what}. _(Discord peut mettre quelques minutes à l’afficher partout.)_`,
    );
  },
};
