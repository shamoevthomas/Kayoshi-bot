import { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } from 'discord.js';
import { addTempBan } from '../../lib/store.js';
import { sendSanctionLog, Colors } from '../../lib/logger.js';
import { parseDuration, formatDuration } from '../../lib/time.js';
import { dmSanction, dmNote } from '../../lib/sanctions.js';

// ID seul ou mention (<@id>) dans l'option « id ».
const MENTION_OR_ID = /^(?:<@!?)?(\d{17,20})>?$/;

export default {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannir un membre, ou un utilisateur absent du serveur via son ID.')
    .addStringOption((o) => o.setName('raison').setDescription('Raison du bannissement').setRequired(true))
    .addStringOption((o) =>
      o
        .setName('afficher_moderateur')
        .setDescription('Afficher ton pseudo au membre dans le MP ?')
        .setRequired(true)
        .addChoices({ name: 'Montrer', value: 'montrer' }, { name: 'Ne pas montrer', value: 'ne pas montrer' }),
    )
    // Options obligatoires d'abord (règle Discord) : le membre OU son ID, l'un des deux.
    .addUserOption((o) => o.setName('membre').setDescription('Le membre à bannir (ou utilise l’option id)'))
    .addStringOption((o) => o.setName('id').setDescription('Ou l’ID d’un utilisateur, même s’il n’est pas sur le serveur'))
    .addStringOption((o) => o.setName('duree').setDescription('Durée (ex: 7d, 12h) — vide = permanent'))
    .addBooleanOption((o) =>
      o.setName('definitif').setDescription('Supprimer ses messages des 7 derniers jours (ex-"ban IP")'),
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .setDMPermission(false),

  async execute(interaction) {
    let target = interaction.options.getUser('membre');
    const rawId = interaction.options.getString('id')?.trim();
    if (!target && rawId) {
      const id = rawId.match(MENTION_OR_ID)?.[1];
      if (!id) return interaction.reply({ content: '❌ ID invalide : c’est un nombre de 17 à 20 chiffres.', ephemeral: true });
      target = await interaction.client.users.fetch(id).catch(() => null);
      if (!target) return interaction.reply({ content: '❌ Aucun utilisateur Discord ne correspond à cet ID.', ephemeral: true });
    }
    if (!target) return interaction.reply({ content: '❌ Choisis le `membre` à bannir, ou donne son `id`.', ephemeral: true });
    if (await interaction.guild.bans.fetch(target.id).catch(() => null)) {
      return interaction.reply({ content: `ℹ️ **${target.tag}** est déjà banni.`, ephemeral: true });
    }
    const reason = interaction.options.getString('raison');
    const durInput = interaction.options.getString('duree');
    const definitif = interaction.options.getBoolean('definitif') ?? false;
    const showMod = interaction.options.getString('afficher_moderateur') === 'montrer';

    const dur = durInput ? parseDuration(durInput) : { permanent: true, ms: null };
    if (dur === null) {
      return interaction.reply({ content: '❌ Durée invalide. Ex : `7d`, `12h`, `30m`, ou laisse vide pour permanent.', ephemeral: true });
    }

    const member = await interaction.guild.members.fetch(target.id).catch(() => null);
    if (member && !member.bannable) {
      return interaction.reply({ content: '❌ Je ne peux pas bannir ce membre (rôle trop haut).', ephemeral: true });
    }

    // MP AVANT le ban (impossible de le joindre une fois banni).
    const dmSent = await dmSanction(target, interaction.guild, dur.permanent ? 'banni' : 'softban (banni temporairement)', reason, interaction.user, showMod);

    await interaction.guild.bans.create(target.id, {
      reason: `${reason} — par ${interaction.user.tag}`,
      deleteMessageSeconds: definitif ? 604_800 : 0,
    });

    // Ban temporaire = softban (débannissement automatique à la fin).
    const isTemp = !dur.permanent;
    let note = 'Bannissement **permanent**.';
    if (isTemp) {
      addTempBan(interaction.guild.id, target.id, Date.now() + dur.ms);
      note = `Débannissement automatique dans **${formatDuration(dur.ms)}**.`;
    }

    await sendSanctionLog(
      interaction.guild,
      new EmbedBuilder()
        .setColor(Colors.delete)
        .setAuthor({ name: isTemp ? '⏳ Softban' : definitif ? '💀 Ban définitif' : '🔨 Bannissement' })
        .setDescription(`${target.tag} (\`${target.id}\`)`)
        .addFields(
          { name: 'Durée', value: dur.permanent ? 'Permanent' : formatDuration(dur.ms), inline: true },
          { name: 'Messages supprimés', value: definitif ? '7 jours' : 'Aucun', inline: true },
          { name: 'Raison', value: reason },
          { name: 'Par', value: `${interaction.user}`, inline: true },
        )
        .setTimestamp(),
    );

    await interaction.reply({
      content: `✅ **${target.tag}** ${isTemp ? 'softban' : 'banni'}. ${note}\nRaison : ${reason}${dmNote(dmSent)}`,
      ephemeral: true,
    });
  },
};
