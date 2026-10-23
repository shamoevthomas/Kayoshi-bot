import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { sendLog, Colors } from '../../lib/logger.js';

// Gestion des emojis du serveur : /emoji rename, /emoji delete, /emoji image.

// Emoji personnalisé écrit par l'utilisateur : <:nom:id>, <a:nom:id>, un id, ou un nom d'emoji du serveur.
function parseCustom(input) {
  const m = input.trim().match(/^<(a?):(\w{2,32}):(\d{17,21})>$/);
  if (m) return { id: m[3], name: m[2], animated: m[1] === 'a' };
  return null;
}

// Emoji DU SERVEUR désigné par le texte (pour rename / delete). null sinon.
function guildEmoji(guild, input) {
  const parsed = parseCustom(input);
  const id = parsed?.id ?? input.trim().match(/^\d{17,21}$/)?.[0];
  if (id) return guild.emojis.cache.get(id) ?? null;
  const key = input.trim().replace(/^:|:$/g, '').toLowerCase();
  return guild.emojis.cache.find((e) => e.name.toLowerCase() === key) ?? null;
}

// Nom d'emoji valide : 2 à 32 caractères, lettres / chiffres / _.
const validName = (name) => /^\w{2,32}$/.test(name);

// Propositions d'autocomplétion : emojis du serveur filtrés par le texte tapé.
function emojiChoices(interaction) {
  const query = interaction.options.getFocused().toLowerCase().replace(/^:|:$/g, '');
  return [...interaction.guild.emojis.cache.values()]
    .filter((e) => e.name.toLowerCase().includes(query))
    .slice(0, 25)
    .map((e) => ({ name: `${e.animated ? '[gif] ' : ''}:${e.name}:`.slice(0, 100), value: e.id }));
}

// Autocomplétion de /emoji delete : complète le DERNIER emoji en gardant ceux déjà choisis,
// pour pouvoir en sélectionner plusieurs d'affilée (dans la limite des 100 caractères Discord).
function multiEmojiChoices(interaction) {
  const raw = interaction.options.getFocused();
  const parts = raw.split(/[\s,]+/).filter(Boolean);
  // Si le texte finit par un séparateur, le dernier emoji est déjà « validé » : on repart d'une saisie vide.
  const endsSep = /[\s,]$/.test(raw) || raw === '';
  const last = endsSep ? '' : (parts.pop() ?? '');
  const chosenIds = new Set(parts.map((p) => guildEmoji(interaction.guild, p)?.id).filter(Boolean));
  const prefix = parts.join(' ');
  const query = last.toLowerCase().replace(/^:|:$/g, '');
  return [...interaction.guild.emojis.cache.values()]
    .filter((e) => !chosenIds.has(e.id) && e.name.toLowerCase().includes(query))
    .slice(0, 25)
    .map((e) => {
      const value = (prefix ? `${prefix} ` : '') + e.id;
      return {
        name: `${prefix ? `(${chosenIds.size + 1}) ` : ''}${e.animated ? '[gif] ' : ''}:${e.name}:`.slice(0, 100),
        value: value.slice(0, 100),
      };
    });
}

const emojiOption = (o, desc) => o.setName('emoji').setDescription(desc).setRequired(true).setAutocomplete(true);

export default {
  data: new SlashCommandBuilder()
    .setName('emoji')
    .setDescription('Gérer les emojis du serveur (renommer, supprimer, image).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('rename')
        .setDescription('Renommer un emoji du serveur.')
        .addStringOption((o) => emojiOption(o, 'L’emoji à renommer'))
        .addStringOption((o) => o.setName('nom').setDescription('Le nouveau nom (2-32 caractères, lettres/chiffres/_)').setRequired(true).setMaxLength(32)),
    )
    .addSubcommand((sub) =>
      sub
        .setName('delete')
        .setDescription('Supprimer un ou plusieurs emojis du serveur.')
        .addStringOption((o) => emojiOption(o, 'Le ou les emojis à supprimer (choisis-en plusieurs, ou sépare-les par un espace)')),
    )
    .addSubcommand((sub) =>
      sub
        .setName('image')
        .setDescription('Envoyer l’image d’un emoji.')
        .addStringOption((o) => emojiOption(o, 'L’emoji (du serveur, ou collé)')),
    ),

  async autocomplete(interaction) {
    const sub = interaction.options.getSubcommand();
    await interaction.respond(sub === 'delete' ? multiEmojiChoices(interaction) : emojiChoices(interaction));
  },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const input = interaction.options.getString('emoji', true);

    // --- image : marche aussi avec un emoji d'un autre serveur (collé) ---
    if (sub === 'image') {
      const emoji = guildEmoji(interaction.guild, input) ?? parseCustom(input);
      if (!emoji) {
        return interaction.reply({ content: '❌ Emoji introuvable. Choisis-en un dans la liste, ou colle un emoji personnalisé.', ephemeral: true });
      }
      const url = `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? 'gif' : 'png'}?size=256`;
      const embed = new EmbedBuilder()
        .setColor(Colors.role)
        .setTitle(`:${emoji.name}:`)
        .setURL(url)
        .setImage(url)
        .setFooter({ text: emoji.animated ? 'Emoji animé' : 'Emoji' });
      return interaction.reply({ embeds: [embed] });
    }

    if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageGuildExpressions)) {
      return interaction.reply({ content: '❌ Il me manque la permission **Gérer les emojis et stickers**.', ephemeral: true });
    }

    // --- delete : un ou plusieurs emojis DU serveur ---
    if (sub === 'delete') {
      const tokens = input.split(/[\s,]+/).filter(Boolean);
      const seen = new Set();
      const targets = [];
      const unknown = [];
      for (const t of tokens) {
        const e = guildEmoji(interaction.guild, t);
        if (!e) unknown.push(t);
        else if (!seen.has(e.id)) {
          seen.add(e.id);
          targets.push(e);
        }
      }
      if (!targets.length) {
        return interaction.reply({ content: '❌ Aucun emoji de ce serveur trouvé. Choisis-en dans la liste.', ephemeral: true });
      }

      const deleted = [];
      const failed = [];
      for (const e of targets) {
        const info = { name: e.name, id: e.id };
        const ok = await e.delete(`/emoji delete par ${interaction.user.tag}`).then(() => true).catch(() => false);
        (ok ? deleted : failed).push(info);
      }

      if (deleted.length) {
        await sendLog(
          interaction.guild,
          new EmbedBuilder()
            .setColor(Colors.delete)
            .setAuthor({ name: `🗑️ ${deleted.length} emoji(s) supprimé(s)` })
            .setDescription(deleted.map((e) => `\`:${e.name}:\` (\`${e.id}\`)`).join('\n'))
            .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
            .setTimestamp(),
        );
      }

      const lines = [];
      if (deleted.length) lines.push(`✅ ${deleted.length} emoji(s) supprimé(s) : ${deleted.map((e) => `\`:${e.name}:\``).join(' ')}`);
      if (failed.length) lines.push(`❌ Échec pour : ${failed.map((e) => `\`:${e.name}:\``).join(' ')}`);
      if (unknown.length) lines.push(`⚠️ Introuvables sur le serveur : ${unknown.map((t) => `\`${t}\``).join(' ')}`);
      return interaction.reply({ content: lines.join('\n'), ephemeral: true });
    }

    // --- rename : un seul emoji DU serveur ---
    const emoji = guildEmoji(interaction.guild, input);
    if (!emoji) {
      return interaction.reply({ content: '❌ Cet emoji n’est pas sur ce serveur. Choisis-en un dans la liste.', ephemeral: true });
    }
    const newName = interaction.options.getString('nom', true).trim();
    if (!validName(newName)) {
      return interaction.reply({ content: '❌ Nom invalide : 2 à 32 caractères, uniquement lettres, chiffres et `_`.', ephemeral: true });
    }
    const oldName = emoji.name;
    if (newName === oldName) return interaction.reply({ content: 'ℹ️ C’est déjà le nom de cet emoji.', ephemeral: true });
    if (interaction.guild.emojis.cache.some((e) => e.id !== emoji.id && e.name === newName)) {
      return interaction.reply({ content: `❌ Un autre emoji s’appelle déjà \`:${newName}:\`.`, ephemeral: true });
    }
    const renamed = await emoji.edit({ name: newName, reason: `/emoji rename par ${interaction.user.tag}` }).then(() => true).catch(() => false);
    if (!renamed) return interaction.reply({ content: '❌ Impossible de renommer cet emoji.', ephemeral: true });
    await sendLog(
      interaction.guild,
      new EmbedBuilder().setColor(Colors.role).setAuthor({ name: '✏️ Emoji renommé' }).setDescription(`<${emoji.animated ? 'a' : ''}:${newName}:${emoji.id}> \`:${oldName}:\` → \`:${newName}:\``).addFields({ name: 'Par', value: `${interaction.user}`, inline: true }).setTimestamp(),
    );
    return interaction.reply({ content: `✅ Emoji \`:${oldName}:\` renommé en \`:${newName}:\` <${emoji.animated ? 'a' : ''}:${newName}:${emoji.id}>.` });
  },
};
