import { SlashCommandBuilder, PermissionFlagsBits, RateLimitError } from 'discord.js';

const MAX_EMOJIS = 25; // au-delà, les limites de Discord rendent l'ajout très long

// Serveurs où une copie est en cours : une seule à la fois (sinon doublons et attente partagée).
const running = new Set();

// Emoji collé tel quel (Nitro) : <:nom:id> ou <a:nom:id>
const MENTION_RE = /<(a?):(\w{2,32}):(\d{17,21})>/g;
// Lien d'emoji (clic droit → « Copier le lien ») : https://cdn.discordapp.com/emojis/<id>.<ext>?...
const LINK_RE = /https?:\/\/(?:media|cdn)\.discordapp\.(?:com|net)\/emojis\/(\d{17,21})\.(\w+)(\?\S*)?/g;

// Extrait les emojis personnalisés du texte, sans doublons.
function parseEmojis(input) {
  const found = new Map();
  for (const [, a, name, id] of input.matchAll(MENTION_RE)) {
    if (!found.has(id)) found.set(id, { id, name, animated: a === 'a' });
  }
  for (const [, id, ext, query] of input.matchAll(LINK_RE)) {
    if (found.has(id)) continue;
    const params = new URLSearchParams(query?.slice(1) ?? '');
    const animated = ext === 'gif' || params.get('animated') === 'true';
    found.set(id, { id, name: params.get('name') || `emoji_${id.slice(-6)}`, animated });
  }
  return [...found.values()];
}

// Nom valide (2-32 caractères, lettres/chiffres/_) et pas déjà pris sur le serveur.
function freeName(guild, wanted) {
  let base = wanted.replace(/[^\w]/g, '_').slice(0, 32);
  if (base.length < 2) base = `emoji_${base}`.slice(0, 32);
  const taken = (n) => guild.emojis.cache.some((e) => e.name === n);
  if (!taken(base)) return base;
  for (let i = 2; ; i += 1) {
    const name = `${base.slice(0, 32 - String(i).length - 1)}_${i}`;
    if (!taken(name)) return name;
  }
}

function errorText(err) {
  switch (err?.code) {
    case 30008:
      return 'plus de place pour les emojis de ce type sur le serveur';
    case 50013:
      return 'permission manquante';
    case 50045:
    case 50138:
      return 'image trop lourde (max 256 Ko)';
    case 'FETCH':
      return 'image introuvable (lien invalide ?)';
    default:
      return 'erreur Discord';
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('copyemoji')
    .setDescription('Copier des emojis d’un autre serveur sur celui-ci.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuildExpressions)
    .setDMPermission(false)
    .addStringOption((o) =>
      o
        .setName('emojis')
        .setDescription('Colle les emojis à copier (ou leurs liens : clic droit → Copier le lien)')
        .setRequired(true),
    ),

  async execute(interaction) {
    const guild = interaction.guild;
    const emojis = parseEmojis(interaction.options.getString('emojis'));

    if (!emojis.length) {
      return interaction.reply({
        content:
          '❌ Aucun emoji personnalisé trouvé.\n' +
          '-# Colle les emojis directement (Nitro), ou leurs liens : clic droit sur l’emoji → **Copier le lien**. ' +
          'Les emojis de base (😀) sont déjà disponibles partout.',
        ephemeral: true,
      });
    }
    if (emojis.length > MAX_EMOJIS) {
      return interaction.reply({ content: `❌ ${MAX_EMOJIS} emojis maximum par commande (tu en as mis ${emojis.length}).`, ephemeral: true });
    }
    const me = guild.members.me;
    if (!me.permissions.any([PermissionFlagsBits.ManageGuildExpressions, PermissionFlagsBits.CreateGuildExpressions])) {
      return interaction.reply({ content: '❌ Il me manque la permission **Gérer les expressions**.', ephemeral: true });
    }

    if (running.has(guild.id)) {
      return interaction.reply({
        content: '⏳ Une copie d’emojis est déjà en cours sur ce serveur : attends son récapitulatif avant d’en relancer une.',
        ephemeral: true,
      });
    }
    running.add(guild.id);
    try {
      await interaction.deferReply({ ephemeral: true });
      await copyEmojis(interaction, emojis);
    } finally {
      running.delete(guild.id);
    }
  },
};

async function copyEmojis(interaction, emojis) {
  const guild = interaction.guild;
  // Noms présents AVANT la copie : un emoji du même nom est considéré comme déjà copié.
  const namesBefore = new Map(guild.emojis.cache.map((x) => [x.name, x]));
  const added = [];
  const already = [];
  const failed = [];
  let blocked = null;
  for (const [i, e] of emojis.entries()) {
    const existing = guild.emojis.cache.get(e.id) ?? namesBefore.get(e.name);
    if (existing) {
      already.push(existing);
      continue;
    }
    if (emojis.length > 1) {
      await interaction.editReply(`⏳ Ajout des emojis… (${i + 1}/${emojis.length})`).catch(() => {});
    }
    try {
      const res = await fetch(`https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? 'gif' : 'png'}`);
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { code: 'FETCH' });
      const emoji = await guild.emojis.create({
        attachment: Buffer.from(await res.arrayBuffer()),
        name: freeName(guild, e.name),
        reason: `/copyemoji par ${interaction.user.tag}`,
      });
      added.push(emoji);
    } catch (err) {
      // Longue attente imposée par Discord (voir rejectOnRateLimit dans index.js) : on s'arrête là.
      if (err instanceof RateLimitError) {
        blocked = { minutes: Math.ceil(Math.max(err.retryAfter, err.timeToReset) / 60_000), rest: emojis.slice(i) };
        break;
      }
      console.error(`[copyemoji] ${e.name} (${e.id}) :`, err?.message ?? err);
      failed.push(`\`:${e.name}:\` — ${errorText(err)}`);
    }
  }

  const lines = [];
  if (added.length) lines.push(`✅ **${added.length}** emoji(s) ajouté(s) : ${added.map((x) => `${x}`).join(' ')}`);
  if (already.length) lines.push(`↪️ Déjà sur le serveur : ${already.map((x) => `${x}`).join(' ')}`);
  if (failed.length) lines.push(`⚠️ **${failed.length}** échec(s) :\n${failed.map((f) => `• ${f}`).join('\n')}`);
  if (blocked) {
    lines.push(
      `⏸️ Discord limite le nombre d’emojis ajoutés d’affilée : réessaie dans **${blocked.minutes} min** environ. ` +
        `Pas encore ajoutés : ${blocked.rest.map((e) => `\`:${e.name}:\``).join(' ')}`,
    );
  }
  return interaction.editReply({ content: lines.join('\n').slice(0, 2000) }).catch(() => {});
}
