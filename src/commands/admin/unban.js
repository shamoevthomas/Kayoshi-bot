import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';
import { removeTempBan } from '../../lib/store.js';
import { sendSanctionLog, Colors } from '../../lib/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Débannir un utilisateur via son ID, ou tout le monde (option tout).')
    .addStringOption((o) => o.setName('id').setDescription('ID de l’utilisateur banni'))
    .addBooleanOption((o) => o.setName('tout').setDescription('Débannir TOUS les bannis du serveur (administrateurs, avec confirmation)'))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false),

  async execute(interaction) {
    if (interaction.options.getBoolean('tout')) return unbanAll(interaction);

    const userId = interaction.options.getString('id')?.trim();
    if (!userId) {
      return interaction.reply({ content: '❌ Donne l’`id` de la personne à débannir, ou mets `tout` à Vrai pour débannir tout le monde.', ephemeral: true });
    }
    const ban = await interaction.guild.bans.fetch(userId).catch(() => null);
    if (!ban) {
      return interaction.reply({ content: '❌ Aucun ban trouvé pour cet ID.', ephemeral: true });
    }
    await interaction.guild.bans.remove(userId, `Débanni par ${interaction.user.tag}`);
    removeTempBan(interaction.guild.id, userId);

    await sendSanctionLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.join)
        .setAuthor({ name: '♻️ Débannissement' })
        .setDescription(`${ban.user.tag} (\`${userId}\`)`)
        .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
        .setTimestamp(),
    );

    await interaction.reply({ content: `✅ **${ban.user.tag}** a été débanni.`, ephemeral: true });
  },
};

// Tous les bans du serveur (Discord les renvoie par paquets de 1000 au plus).
async function fetchAllBans(guild) {
  const bans = [];
  let after;
  for (;;) {
    const page = await guild.bans.fetch({ limit: 1000, after, cache: false });
    bans.push(...page.values());
    if (page.size < 1000) return bans;
    after = page.lastKey();
  }
}

// /unban tout : réservé aux administrateurs, après confirmation (difficile à défaire :
// il faudrait rebannir chaque personne).
async function unbanAll(interaction) {
  const { guild } = interaction;
  if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
    return interaction.reply({ content: '❌ Débannir tout le monde est réservé aux **administrateurs**.', ephemeral: true });
  }
  await interaction.deferReply({ ephemeral: true });
  const bans = await fetchAllBans(guild).catch(() => null);
  if (!bans) return interaction.editReply('❌ Impossible de lire la liste des bannis (il me faut la permission **Bannir des membres**).');
  if (!bans.length) return interaction.editReply('ℹ️ Personne n’est banni sur ce serveur.');

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('unball_yes').setLabel(`Débannir ${bans.length} personne(s)`).setStyle(ButtonStyle.Danger).setEmoji('♻️'),
    new ButtonBuilder().setCustomId('unball_no').setLabel('Annuler').setStyle(ButtonStyle.Secondary),
  );
  const msg = await interaction.editReply({
    content: `⚠️ Tu vas débannir **${bans.length}** personne(s). Pour les rebannir, il faudra le refaire une par une. Confirmer ?`,
    components: [row],
  });

  let choice;
  try {
    choice = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 60_000, filter: (i) => i.user.id === interaction.user.id });
  } catch {
    return interaction.editReply({ content: '⏳ Temps écoulé, personne n’a été débanni.', components: [] }).catch(() => {});
  }
  if (choice.customId === 'unball_no') return choice.update({ content: 'Annulé : personne n’a été débanni.', components: [] });

  await choice.update({ content: `⏳ Débannissement… (0/${bans.length})`, components: [] });
  let done = 0;
  let failed = 0;
  for (const [i, ban] of bans.entries()) {
    const ok = await guild.bans
      .remove(ban.user.id, `Débannissement général par ${interaction.user.tag}`)
      .then(() => true)
      .catch(() => false);
    if (ok) {
      done++;
      removeTempBan(guild.id, ban.user.id);
    } else failed++;
    if ((i + 1) % 10 === 0) await interaction.editReply(`⏳ Débannissement… (${i + 1}/${bans.length})`).catch(() => {});
  }

  await sendSanctionLog(
    guild,
    new EmbedBuilder()
      .setColor(Colors.join)
      .setAuthor({ name: '♻️ Débannissement général' })
      .setDescription(`**${done}** utilisateur(s) débanni(s)${failed ? `, ${failed} échec(s)` : ''}.`)
      .addFields({ name: 'Par', value: `${interaction.user}`, inline: true })
      .setTimestamp(),
  );
  await interaction
    .editReply(`✅ **${done}** personne(s) débannie(s).${failed ? `\n⚠️ ${failed} échec(s) (déjà débanni·e·s ou erreur Discord).` : ''}`)
    .catch(() => {});
}
