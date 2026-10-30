import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, Constants } from 'discord.js';
import { parseColor } from '../../lib/shop.js';
import { sendLog, Colors } from '../../lib/logger.js';
import { roleCommandProblem } from '../../lib/roles.js';
import { getTempRole, removeTempRole } from '../../lib/store.js';

// /role membre : ajouter ou retirer (bascule) un rôle à un membre · /role create : créer un rôle ·
// /role change : modifier son nom, sa couleur et/ou son emplacement.
export default {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Ajouter ou retirer un rôle à un membre, créer un rôle ou le modifier (nom, couleur, emplacement).')
    .addSubcommand((s) =>
      s
        .setName('membre')
        .setDescription('Ajouter ou retirer un rôle à un membre (bascule).')
        .addUserOption((o) => o.setName('membre').setDescription('Le membre').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Le rôle à ajouter/retirer').setRequired(true)),
    )
    .addSubcommand((s) =>
      s
        .setName('create')
        .setDescription('Créer un rôle : nom, couleur, et dégradé si tu veux.')
        .addStringOption((o) => o.setName('nom').setDescription('Le nom du rôle').setRequired(true).setMaxLength(100))
        .addStringOption((o) => o.setName('couleur').setDescription('Couleur en hex, ex : #ff66cc (gris par défaut)'))
        .addStringOption((o) => o.setName('degrade').setDescription('Deuxième couleur en hex : le rôle sera en dégradé (vide = couleur unie)'))
        .addBooleanOption((o) => o.setName('holographique').setDescription('Style holographique de Discord (remplace les couleurs)')),
    )
    .addSubcommand((s) =>
      s
        .setName('change')
        .setDescription('Modifier un rôle : nom, couleur et/ou emplacement (seulement ce que tu remplis).')
        .addRoleOption((o) => o.setName('role').setDescription('Le rôle à modifier').setRequired(true))
        .addStringOption((o) => o.setName('nom').setDescription('Nouveau nom').setMaxLength(100))
        .addStringOption((o) => o.setName('couleur').setDescription('Nouvelle couleur en hex, ex : #ff66cc'))
        .addStringOption((o) => o.setName('degrade').setDescription('Deuxième couleur en hex pour un dégradé (« aucun » pour revenir à une couleur unie)'))
        .addBooleanOption((o) => o.setName('holographique').setDescription('Style holographique de Discord (remplace les couleurs)'))
        .addRoleOption((o) => o.setName('au_dessus_de').setDescription('Placer le rôle juste au-dessus de ce rôle'))
        .addRoleOption((o) => o.setName('en_dessous_de').setDescription('Placer le rôle juste en dessous de ce rôle')),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false),

  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'change') return change(interaction);
    if (interaction.options.getSubcommand() === 'create') return create(interaction);
    const target = interaction.options.getUser('membre');
    const role = interaction.options.getRole('role');
    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Membre introuvable.', ephemeral: true });

    // @everyone, rôle d'intégration, rôle au-dessus du bot ou de l'auteur (sauf propriétaire) : refusé.
    const problem = roleCommandProblem(interaction, role);
    if (problem) return interaction.reply({ content: problem, ephemeral: true });

    const had = member.roles.cache.has(role.id);
    if (had) await member.roles.remove(role, `Par ${interaction.user.tag}`);
    else await member.roles.add(role, `Par ${interaction.user.tag}`);
    // Rôle donné avec /roletempo et retiré avant la fin : plus rien à retirer plus tard.
    const wasTemporary = had && Boolean(getTempRole(interaction.guild.id, member.id, role.id));
    if (had) removeTempRole(interaction.guild.id, member.id, role.id);

    await sendLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.role)
        .setAuthor({ name: had ? '➖ Rôle retiré' : '➕ Rôle ajouté' })
        .setDescription(`${role} ${had ? 'retiré à' : 'ajouté à'} ${target}${wasTemporary ? ' (rôle temporaire, avant la fin)' : ''}`)
        .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
        .setTimestamp(),
    );

    await interaction.reply({
      content: had ? `✅ Rôle ${role} retiré à ${target}.` : `✅ Rôle ${role} ajouté à ${target}.`,
      ephemeral: true,
    });
  },
};

// /role change : seulement ce qui est rempli (nom, couleur / dégradé / holographique, emplacement).
// Sans option : l'état actuel du rôle. Emplacement juste au-dessus ou juste en dessous d'un autre rôle.
const hex = (n) => `#${(n ?? 0).toString(16).padStart(6, '0')}`;
const styleText = (colors) =>
  colors?.tertiaryColor ? 'holographique' : colors?.secondaryColor ? `dégradé ${hex(colors.primaryColor)} → ${hex(colors.secondaryColor)}` : hex(colors?.primaryColor);

async function change(interaction) {
  const { guild, user, member } = interaction;
  const role = interaction.options.getRole('role');
  const name = interaction.options.getString('nom')?.trim() || null;
  const rawColor = interaction.options.getString('couleur');
  const rawGradient = interaction.options.getString('degrade');
  const holographic = interaction.options.getBoolean('holographique');
  const above = interaction.options.getRole('au_dessus_de');
  const below = interaction.options.getRole('en_dessous_de');

  // Mêmes limites que pour donner un rôle : pas @everyone, ni un rôle au-dessus du bot ou de l'auteur.
  const problem = roleCommandProblem(interaction, role, 'modifier');
  if (problem) return interaction.reply({ content: problem, ephemeral: true });

  if (!name && !rawColor && !rawGradient && holographic === null && !above && !below) {
    return interaction.reply({
      content:
        `ℹ️ ${role} — nom **${role.name}** · couleur **${styleText(role.colors)}** · ${role.position}ᵉ en partant du bas (${role.members.size} membre(s))\n` +
        '-# Remplis les options à changer : `nom`, `couleur`, `degrade`, `holographique`, `au_dessus_de` ou `en_dessous_de`.',
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  }

  // Couleurs : la nouvelle couleur (ou l'actuelle), en dégradé si demandé ; « aucun » retire le dégradé.
  const noGradient = rawGradient && ['aucun', 'aucune', 'non', 'none'].includes(rawGradient.trim().toLowerCase());
  const color = rawColor ? parseColor(rawColor) : role.colors.primaryColor;
  const gradient = rawGradient && !noGradient ? parseColor(rawGradient) : null;
  if (color === null || (rawGradient && !noGradient && gradient === null)) {
    return interaction.reply({ content: '❌ Couleur invalide : écris-la en hex, ex : `#ff66cc` (ou `aucun` pour retirer le dégradé).', ephemeral: true });
  }
  let colors = null;
  if (holographic) colors = { primaryColor: Constants.HolographicStyle.Primary, secondaryColor: Constants.HolographicStyle.Secondary, tertiaryColor: Constants.HolographicStyle.Tertiary };
  else if (gradient !== null) colors = { primaryColor: color, secondaryColor: gradient, tertiaryColor: null };
  else if (rawColor || noGradient || holographic === false) {
    // Nouvelle couleur unie ; sans « aucun », un dégradé déjà en place est gardé avec la nouvelle couleur.
    const keepGradient = !noGradient && holographic !== false && !role.colors.tertiaryColor ? role.colors.secondaryColor : null;
    colors = { primaryColor: color, secondaryColor: keepGradient ?? null, tertiaryColor: null };
  }

  // Emplacement : l'un ou l'autre, un autre rôle, que le bot et l'auteur peuvent atteindre.
  if (above && below) return interaction.reply({ content: '❌ Choisis **soit** `au_dessus_de`, **soit** `en_dessous_de`.', ephemeral: true });
  const ref = above ?? below;
  let position = null;
  if (ref) {
    if (ref.id === role.id) return interaction.reply({ content: '❌ Choisis un autre rôle que celui que tu modifies.', ephemeral: true });
    if (below && ref.id === guild.id) return interaction.reply({ content: '❌ Aucun rôle ne peut être sous @everyone.', ephemeral: true });
    const top = guild.members.me.roles.highest.position;
    const mine = user.id === guild.ownerId ? Infinity : member.roles.highest.position;
    // Le rôle doit finir sous mon rôle le plus haut et sous celui de l'auteur : au-dessus d'un rôle qui
    // est lui-même en dessous, ou en dessous d'un rôle qui va jusqu'à leur niveau.
    if (above ? ref.position >= top : ref.position > top) {
      return interaction.reply({ content: `❌ Je ne peux pas monter ${role} aussi haut : il doit rester sous mon rôle le plus haut.`, ephemeral: true, allowedMentions: { parse: [] } });
    }
    if (above ? ref.position >= mine : ref.position > mine) {
      return interaction.reply({ content: `❌ Tu ne peux pas monter ${role} au niveau de ton rôle le plus haut ou au-dessus.`, ephemeral: true, allowedMentions: { parse: [] } });
    }
    // Juste au-dessus de X : la place de X + 1 ; juste en dessous de Y : la place de Y (le rôle sort de sa place d'abord).
    position = above ? ref.position + 1 - (role.position < ref.position ? 1 : 0) : ref.position - (role.position < ref.position ? 1 : 0);
    if (position === role.position) position = null; // déjà à cette place
  }

  await interaction.deferReply({ ephemeral: true });
  const reason = `Par ${user.tag}`;
  const before = { name: role.name, style: styleText(role.colors), position: role.position };
  const changes = [];
  let note = '';

  if (name && name !== role.name) {
    const ok = await role.setName(name, reason).then(() => true).catch(() => false);
    changes.push(ok ? `• Nom : **${before.name}** → **${name}**` : '• ❌ Nom : Discord a refusé le changement');
  }
  if (colors) {
    let ok = await role.setColors(colors, reason).then(() => true).catch(() => false);
    if (!ok && colors.secondaryColor) {
      ok = await role.setColors({ primaryColor: colors.tertiaryColor ? color : colors.primaryColor, secondaryColor: null, tertiaryColor: null }, reason).then(() => true).catch(() => false);
      if (ok) note = '\n⚠️ Discord a refusé le dégradé ou l’holographique (il faut assez de boosts) : couleur unie.';
    }
    changes.push(ok ? `• Couleur : **${before.style}** → **${styleText(role.colors)}**` : '• ❌ Couleur : Discord a refusé le changement');
  }
  if (position !== null) {
    const ok = await role.setPosition(position, { reason }).then(() => true).catch(() => false);
    changes.push(ok ? `• Emplacement : juste ${above ? 'au-dessus de' : 'en dessous de'} ${ref}` : '• ❌ Emplacement : Discord a refusé le déplacement');
  } else if (ref) changes.push(`• Emplacement : déjà juste ${above ? 'au-dessus de' : 'en dessous de'} ${ref}`);

  if (!changes.length) return interaction.editReply({ content: `ℹ️ Rien à changer : ${role} est déjà comme ça.`, allowedMentions: { parse: [] } });
  await sendLog(
    guild,
    new EmbedBuilder()
      .setColor(role.colors.primaryColor || Colors.role)
      .setAuthor({ name: '🛠️ Rôle modifié' })
      .setDescription(`${role}\n${changes.join('\n')}`)
      .addFields({ name: 'Par', value: `${user}`, inline: true })
      .setTimestamp(),
  );
  return interaction.editReply({ content: `✅ ${role} modifié :\n${changes.join('\n')}${note}`, allowedMentions: { parse: [] } });
}

// /role create : nouveau rôle sans permission, en bas de la liste. Dégradé = deux couleurs ; holographique =
// le style de Discord (couleurs fixes). Si Discord refuse le style (pas assez de boosts), couleur unie.
async function create(interaction) {
  const { guild, user } = interaction;
  const name = interaction.options.getString('nom').trim();
  const rawColor = interaction.options.getString('couleur');
  const rawGradient = interaction.options.getString('degrade');
  const holographic = interaction.options.getBoolean('holographique') ?? false;
  const color = rawColor ? parseColor(rawColor) : 0x99aab5;
  const gradient = rawGradient ? parseColor(rawGradient) : null;
  if (!name) return interaction.reply({ content: '❌ Donne un nom au rôle.', ephemeral: true });
  if (color === null || (rawGradient && gradient === null)) {
    return interaction.reply({ content: '❌ Couleur invalide : écris-la en hex, ex : `#ff66cc`.', ephemeral: true });
  }

  let colors = { primaryColor: color };
  if (holographic) colors = { primaryColor: Constants.HolographicStyle.Primary, secondaryColor: Constants.HolographicStyle.Secondary, tertiaryColor: Constants.HolographicStyle.Tertiary };
  else if (gradient !== null) colors = { primaryColor: color, secondaryColor: gradient };
  const reason = `Par ${user.tag}`;
  let note = '';
  let role = await guild.roles.create({ name, colors, permissions: [], reason }).catch(() => null);
  if (!role && colors.secondaryColor !== undefined) {
    role = await guild.roles.create({ name, colors: { primaryColor: color }, permissions: [], reason }).catch(() => null);
    if (role) note = '\n⚠️ Discord a refusé le dégradé (il faut assez de boosts sur le serveur) : le rôle est en couleur unie.';
  }
  if (!role) return interaction.reply({ content: '❌ Je n’ai pas pu créer le rôle (permission « Gérer les rôles » ?).', ephemeral: true });

  const hex = (n) => `#${n.toString(16).padStart(6, '0')}`;
  const style = note ? hex(color) : holographic ? 'holographique' : gradient !== null ? `dégradé ${hex(color)} → ${hex(gradient)}` : hex(color);
  await sendLog(
    guild,
    new EmbedBuilder()
      .setColor(color)
      .setAuthor({ name: '🆕 Rôle créé' })
      .setDescription(`${role} (${style})`)
      .addFields({ name: 'Par', value: `${user}`, inline: true })
      .setTimestamp(),
  );
  return interaction.reply({
    content: `✅ Rôle ${role} créé (${style}).${note}\n-# Il est en bas de la liste des rôles, sans permission : déplace-le ou donne-le avec \`/role membre\`.`,
    ephemeral: true,
    allowedMentions: { parse: [] },
  });
}
