import { LabelBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } from 'discord.js';
import { getStatusKeywords, setStatusKeywords } from './store.js';
import { sweepAutoRolesGuild } from './autoroles.js';

// /statut role : formulaire des mots-clés (un par ligne) puis activation. Le rôle est donné aux membres
// dont le statut contient un des mots-clés, et retiré quand ils l'enlèvent (voir autoroles.js).
const MAX_KEYWORDS = 50;
const MAX_LENGTH = 100;

export function keywordsModal(roleId, keywords = []) {
  return new ModalBuilder()
    .setCustomId(`stat_kw:${roleId}`)
    .setTitle('Rôle selon le statut')
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('Mots-clés (un par ligne)')
        .setDescription('Le rôle est donné si le statut contient un de ces mots (majuscules ignorées)')
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId('keywords')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(4000)
            .setPlaceholder('.gg/hanamifr\n/hanamifr')
            .setValue(keywords.join('\n')),
        ),
    );
}

// Envoi du formulaire : un mot-clé par ligne (lignes vides et doublons ignorés).
export async function handleStatusRoleModal(interaction) {
  const roleId = interaction.customId.split(':')[1];
  const lines = interaction.fields.getTextInputValue('keywords').split('\n').map((l) => l.trim()).filter(Boolean);
  const seen = new Set();
  const keywords = lines.filter((k) => !seen.has(k.toLowerCase()) && seen.add(k.toLowerCase()));
  const tooLong = keywords.find((k) => k.length > MAX_LENGTH);
  if (tooLong) return interaction.reply({ content: `❌ Mot-clé trop long (${MAX_LENGTH} caractères max) : \`${tooLong.slice(0, 50)}…\``, ephemeral: true });
  if (keywords.length > MAX_KEYWORDS) return interaction.reply({ content: `❌ ${MAX_KEYWORDS} mots-clés maximum (tu en as mis ${keywords.length}).`, ephemeral: true });

  setStatusKeywords(interaction.guild.id, { enabled: true, roleId, keywords });
  await interaction.deferReply({ ephemeral: true });
  // Applique tout de suite aux membres déjà présents (ceux dont le statut est connu du bot).
  await sweepAutoRolesGuild(interaction.guild).catch((err) => console.error('[statut role]', err));
  return interaction.editReply(
    `✅ Rôle selon le statut **activé** : <@&${roleId}> pour les membres dont le statut contient :\n` +
      keywords.map((k) => `• \`${k}\``).join('\n') +
      '\n-# Le rôle est retiré quand le mot-clé disparaît du statut.',
  );
}

export function disableStatusRole(guildId) {
  const cfg = getStatusKeywords(guildId);
  if (!cfg?.enabled) return false;
  setStatusKeywords(guildId, { ...cfg, enabled: false });
  return true;
}
