import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import { setGifHint } from '../../lib/store.js';

const ROLE_OPTIONS = ['role_ignoré_1', 'role_ignoré_2', 'role_ignoré_3', 'role_ignoré_4'];

export default {
  data: (() => {
    const builder = new SlashCommandBuilder()
      .setName('messimage')
      .setDescription('Message envoyé quand un membre poste un GIF sans la perm image.')
      .addStringOption((o) =>
        o
          .setName('message')
          .setDescription('Le message (le membre est mentionné devant)')
          .setMaxLength(1800)
          .setRequired(true),
      )
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setDMPermission(false);
    for (const name of ROLE_OPTIONS) {
      builder.addRoleOption((o) => o.setName(name).setDescription('(Facultatif) Rôle ignoré : ses membres ne reçoivent pas le message'));
    }
    return builder;
  })(),

  async execute(interaction) {
    const message = interaction.options.getString('message').trim();
    const roles = ROLE_OPTIONS.map((name) => interaction.options.getRole(name)).filter(Boolean);
    const ignoredRoleIds = [...new Set(roles.map((r) => r.id))];

    setGifHint(interaction.guild.id, { message, ignoredRoleIds });
    const ignored = ignoredRoleIds.length ? `\nRôles ignorés : ${ignoredRoleIds.map((id) => `<@&${id}>`).join(', ')}` : '';
    await interaction.reply({
      content: `✅ Quand un membre sans la perm image poste un GIF (Tenor, Klipy, Giphy, .gif), j’enverrai :\n> ${interaction.user} ${message}${ignored}`,
      allowedMentions: { parse: [] },
      ephemeral: true,
    });
  },
};
