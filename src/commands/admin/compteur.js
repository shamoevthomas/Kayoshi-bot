import { SlashCommandBuilder, PermissionFlagsBits, ChannelType } from 'discord.js';
import { getCounting, setCounting } from '../../lib/store.js';

// Salon de comptage (voir lib/counting.js).
export default {
  data: new SlashCommandBuilder()
    .setName('compteur')
    .setDescription('Salon de comptage : les membres comptent 1, 2, 3… à tour de rôle, sans fin.')
    .addSubcommand((s) =>
      s
        .setName('activer')
        .setDescription('Choisir le salon de comptage.')
        .addChannelOption((o) => o.setName('salon').setDescription('Le salon').setRequired(true).addChannelTypes(ChannelType.GuildText)),
    )
    .addSubcommand((s) => s.setName('desactiver').setDescription('Arrêter le comptage.'))
    .addSubcommand((s) => s.setName('voir').setDescription('Nombre actuel et record.'))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false),

  async execute(interaction) {
    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand();
    const cfg = getCounting(guildId);

    if (sub === 'voir') {
      if (!cfg?.channelId) return interaction.reply({ content: 'ℹ️ Aucun salon de comptage. Lance `/compteur activer`.', ephemeral: true });
      return interaction.reply({
        content: `🔢 Salon : <#${cfg.channelId}> · nombre actuel : **${cfg.current ?? '0'}** · record : **${cfg.record ?? '0'}**`,
        ephemeral: true,
      });
    }
    if (sub === 'desactiver') {
      if (!cfg?.channelId) return interaction.reply({ content: 'ℹ️ Le comptage n’était pas activé.', ephemeral: true });
      setCounting(guildId, { ...cfg, channelId: null });
      return interaction.reply({ content: '✅ Comptage désactivé (le record est gardé).', ephemeral: true });
    }

    // activer : nouveau salon = on repart de 0 (le record est gardé si c'est le même salon).
    const channel = interaction.options.getChannel('salon');
    const same = cfg?.channelId === channel.id || cfg?.lastChannelId === channel.id;
    setCounting(guildId, {
      channelId: channel.id,
      lastChannelId: channel.id,
      current: same ? (cfg.current ?? '0') : '0',
      record: same ? (cfg.record ?? '0') : '0',
      lastUserId: same ? (cfg.lastUserId ?? null) : null,
    });
    const next = same ? BigInt(cfg.current ?? '0') + 1n : 1n;
    await channel
      .send(`🔢 **Comptage !** Écrivez les nombres dans l’ordre, chacun votre tour, sans fin. Prochain nombre : **${next}**.\n-# Un mauvais nombre, ou deux fois de suite la même personne, et on recommence à 1.`)
      .catch(() => {});
    return interaction.reply({ content: `✅ Comptage activé dans ${channel}.`, ephemeral: true });
  },
};
