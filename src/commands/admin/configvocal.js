import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { setVoiceConfig, getVoiceConfig } from '../../lib/store.js';

export default {
  data: new SlashCommandBuilder()
    .setName('configvocal')
    .setDescription('Configurer les salons vocaux temporaires (Join to Create).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  async execute(interaction) {
    const guild = interaction.guild;
    const filter = (i) => i.user.id === interaction.user.id;
    // Conserve les vocaux temporaires déjà suivis
    const existing = getVoiceConfig(guild.id);
    const config = { generatorChannelId: null, categoryId: null, nameTemplate: 'Salon de [user]', defaultLimit: 0, temp: existing?.temp ?? {} };

    const catPrompt = '\n\n**2/3 — Catégorie**\nDans quelle catégorie ranger les vocaux créés ?';
    const catRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cfgvoc_catcreate').setLabel('Créer une catégorie').setStyle(ButtonStyle.Success).setEmoji('➕'),
      new ButtonBuilder().setCustomId('cfgvoc_catexisting').setLabel('Catégorie existante').setStyle(ButtonStyle.Primary).setEmoji('📁'),
    );

    const step1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cfgvoc_gencreate').setLabel('Créer le salon générateur').setStyle(ButtonStyle.Success).setEmoji('➕'),
      new ButtonBuilder().setCustomId('cfgvoc_genexisting').setLabel('Vocal existant').setStyle(ButtonStyle.Primary).setEmoji('📁'),
    );
    const msg = await interaction.reply({
      content: '**1/3 — Salon générateur**\nLe salon vocal que les membres rejoignent pour créer le leur.',
      components: [step1],
      ephemeral: true,
      fetchReply: true,
    });

    try {
      // ===== 1/3 — Salon générateur =====
      const b1 = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 300_000, filter });
      if (b1.customId === 'cfgvoc_gencreate') {
        const ch = await guild.channels.create({ name: '➕ Créer un vocal', type: ChannelType.GuildVoice });
        config.generatorChannelId = ch.id;
        await b1.update({ content: `✅ Générateur créé : **${ch.name}**${catPrompt}`, components: [catRow] });
      } else {
        await b1.update({
          content: 'Choisis le vocal générateur :',
          components: [
            new ActionRowBuilder().addComponents(
              new ChannelSelectMenuBuilder().setCustomId('cfgvoc_genchan').setPlaceholder('Choisis un salon vocal').addChannelTypes(ChannelType.GuildVoice),
            ),
          ],
        });
        const s = await msg.awaitMessageComponent({ componentType: ComponentType.ChannelSelect, time: 300_000, filter });
        config.generatorChannelId = s.values[0];
        await s.update({ content: `✅ Générateur : <#${config.generatorChannelId}>${catPrompt}`, components: [catRow] });
      }

      // ===== 2/3 — Catégorie =====
      const writeBtn = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cfgvoc_opts').setLabel('Nom & limite par défaut').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
      );
      const optsPrompt = '\n\n**3/3 — Nom et limite par défaut**\nClique pour définir le nom (`[user]` = pseudo) et la limite d’utilisateurs.';

      const b2 = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 300_000, filter });
      if (b2.customId === 'cfgvoc_catcreate') {
        const cat = await guild.channels.create({ name: 'Vocaux temporaires', type: ChannelType.GuildCategory });
        config.categoryId = cat.id;
        await b2.update({ content: `✅ Catégorie créée : **${cat.name}**${optsPrompt}`, components: [writeBtn] });
      } else {
        await b2.update({
          content: 'Choisis la catégorie :',
          components: [
            new ActionRowBuilder().addComponents(
              new ChannelSelectMenuBuilder().setCustomId('cfgvoc_catchan').setPlaceholder('Choisis une catégorie').addChannelTypes(ChannelType.GuildCategory),
            ),
          ],
        });
        const s = await msg.awaitMessageComponent({ componentType: ComponentType.ChannelSelect, time: 300_000, filter });
        config.categoryId = s.values[0];
        await s.update({ content: `✅ Catégorie : <#${config.categoryId}>${optsPrompt}`, components: [writeBtn] });
      }

      // ===== 3/3 — Nom & limite (modal) =====
      const ob = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 300_000, filter });
      const modal = new ModalBuilder()
        .setCustomId('cfgvoc_modal')
        .setTitle('Nom & limite par défaut')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('name').setLabel('Nom par défaut ([user] = pseudo)').setValue('Salon de [user]').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100),
          ),
          new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('limit').setLabel('Limite d’utilisateurs (0 = illimité)').setValue('0').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2),
          ),
        );
      await ob.showModal(modal);

      const sub = await ob.awaitModalSubmit({ time: 600_000, filter: (i) => i.customId === 'cfgvoc_modal' && i.user.id === interaction.user.id });
      config.nameTemplate = sub.fields.getTextInputValue('name') || 'Salon de [user]';
      config.defaultLimit = Math.min(99, Math.max(0, parseInt(sub.fields.getTextInputValue('limit'), 10) || 0));

      setVoiceConfig(guild.id, config);
      await sub.update({
        content:
          `✅ **Vocaux temporaires configurés !**\n` +
          `• Générateur : <#${config.generatorChannelId}>\n` +
          `• Catégorie : <#${config.categoryId}>\n` +
          `• Nom par défaut : \`${config.nameTemplate}\`\n` +
          `• Limite par défaut : ${config.defaultLimit === 0 ? 'illimité' : config.defaultLimit}\n\n` +
          `Les membres qui rejoignent le générateur obtiendront leur salon + un panneau de contrôle.`,
        components: [],
        embeds: [],
      });
    } catch (err) {
      console.error(err);
      return interaction.editReply({ content: '⏱️ Configuration annulée (délai dépassé ou erreur). Relance `/configvocal`.', components: [], embeds: [] }).catch(() => {});
    }
  },
};
