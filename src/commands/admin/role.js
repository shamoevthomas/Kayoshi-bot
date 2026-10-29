import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, Constants } from 'discord.js';
import { parseColor } from '../../lib/shop.js';
import { sendLog, Colors } from '../../lib/logger.js';
import { roleCommandProblem } from '../../lib/roles.js';
import { getTempRole, removeTempRole } from '../../lib/store.js';

// /role membre : ajouter ou retirer (bascule) un rôle à un membre · /role create : créer un rôle ·
// /role rename : renommer un rôle.
export default {
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Ajouter ou retirer un rôle à un membre, créer un rôle (couleur, dégradé) ou le renommer.')
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
        .setName('rename')
        .setDescription('Renommer un rôle.')
        .addRoleOption((o) => o.setName('role').setDescription('Le rôle à renommer').setRequired(true))
        .addStringOption((o) => o.setName('nom').setDescription('Le nouveau nom').setRequired(true).setMaxLength(100)),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false),

  async execute(interaction) {
    if (interaction.options.getSubcommand() === 'rename') return rename(interaction);
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

async function rename(interaction) {
  const role = interaction.options.getRole('role');
  const name = interaction.options.getString('nom').trim();
  // Mêmes limites que pour donner un rôle : pas @everyone, ni un rôle au-dessus du bot ou de l'auteur.
  const problem = roleCommandProblem(interaction, role, 'renommer');
  if (problem) return interaction.reply({ content: problem, ephemeral: true });
  if (!name) return interaction.reply({ content: '❌ Donne un nouveau nom.', ephemeral: true });
  const before = role.name;
  if (before === name) return interaction.reply({ content: `ℹ️ ${role} s’appelle déjà **${name}**.`, ephemeral: true });
  const ok = await role.setName(name, `Par ${interaction.user.tag}`).then(() => true).catch(() => false);
  if (!ok) return interaction.reply({ content: '❌ Discord a refusé le renommage (permission « Gérer les rôles » ?).', ephemeral: true });

  await sendLog(
    interaction.guild,
    new EmbedBuilder()
      .setColor(Colors.role)
      .setAuthor({ name: '✏️ Rôle renommé' })
      .setDescription(`${role} : **${before}** → **${name}**`)
      .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
      .setTimestamp(),
  );
  return interaction.reply({ content: `✅ Rôle renommé : **${before}** → ${role}.`, ephemeral: true, allowedMentions: { parse: [] } });
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
