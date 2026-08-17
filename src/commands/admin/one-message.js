import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import {
  enableOneMessage,
  disableOneMessage,
  getOneMessageConfig,
} from '../../lib/store.js';

const TEXT_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice];

export default {
  data: new SlashCommandBuilder()
    .setName('one-message')
    .setDescription('Salon où les nouveaux messages sont supprimés automatiquement.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('activer')
        .setDescription('Activer la suppression auto (salon actuel par défaut, ou pour un membre précis).')
        .addChannelOption((o) =>
          o.setName('salon').setDescription('Le salon (par défaut : le salon actuel)').addChannelTypes(...TEXT_TYPES),
        )
        .addUserOption((o) =>
          o.setName('membre').setDescription('(Facultatif) ne supprimer que les messages de ce membre'),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName('desactiver')
        .setDescription('Désactiver la suppression auto (salon actuel par défaut, ou pour un membre précis).')
        .addChannelOption((o) =>
          o.setName('salon').setDescription('Le salon (par défaut : le salon actuel)').addChannelTypes(...TEXT_TYPES),
        )
        .addUserOption((o) =>
          o.setName('membre').setDescription('(Facultatif) ne retirer que ce membre de la liste ciblée'),
        ),
    )
    .addSubcommand((sub) => sub.setName('liste').setDescription('Voir les salons concernés.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'liste') {
      const cfg = getOneMessageConfig(guildId);
      const ids = Object.keys(cfg);
      if (!ids.length) {
        return interaction.reply({ content: 'Aucun salon en mode « one-message ».', ephemeral: true });
      }
      const lines = ids.map((id) => {
        const targets = cfg[id];
        const who = targets.length ? targets.map((m) => `<@${m}>`).join(', ') : 'tout le monde';
        return `• <#${id}> → ${who}`;
      });
      return interaction.reply({ content: `🔒 Salons en mode « one-message » :\n${lines.join('\n')}`, ephemeral: true });
    }

    const channel = interaction.options.getChannel('salon') ?? interaction.channel;
    const member = interaction.options.getUser('membre');

    if (sub === 'activer') {
      const perms = channel.permissionsFor(interaction.guild.members.me);
      // Sans "Voir le salon", Discord ne m'envoie aucun message de ce salon :
      // impossible d'y supprimer quoi que ce soit.
      const missing = [];
      if (!perms?.has(PermissionFlagsBits.ViewChannel)) missing.push('**Voir le salon**');
      if (!perms?.has(PermissionFlagsBits.ManageMessages)) missing.push('**Gérer les messages**');
      if (missing.length) {
        return interaction.reply({
          content: `❌ Il me manque ${missing.join(' et ')} dans ${channel}. Sans ça je ne peux pas y supprimer les messages.`,
          ephemeral: true,
        });
      }
      const targets = enableOneMessage(guildId, channel.id, member?.id ?? null);
      const scope = targets.length ? `les messages de ${targets.map((m) => `<@${m}>`).join(', ')}` : 'tous les nouveaux messages';
      return interaction.reply({
        content: `✅ Mode « one-message » actif dans ${channel} : **${scope}** seront supprimés aussitôt. (Les anciens messages restent.)`,
        ephemeral: true,
      });
    }

    // desactiver
    const { status } = disableOneMessage(guildId, channel.id, member?.id ?? null);
    const messages = {
      'not-active': `ℹ️ ${channel} n'était pas en mode « one-message ».`,
      'channel-removed': `✅ ${channel} n'est plus en mode « one-message ». Les membres peuvent de nouveau écrire.`,
      'member-removed': `✅ ${member} n'est plus ciblé dans ${channel} (les autres membres ciblés le restent).`,
      'was-all': `ℹ️ ${channel} supprime les messages de **tout le monde**. Pour tout désactiver, relance sans préciser de membre.`,
      'not-targeted': `ℹ️ ${member} n'était pas ciblé dans ${channel}.`,
    };
    return interaction.reply({ content: messages[status], ephemeral: true });
  },
};
