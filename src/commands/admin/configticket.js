import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { parseMotifs, createCategories, buildTicketPanel } from '../../lib/tickets.js';
import { setTicketConfig } from '../../lib/store.js';

const P = PermissionFlagsBits;

function textInput(id, label, placeholder, style, max) {
  return new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label.slice(0, 45))
    .setPlaceholder(placeholder)
    .setStyle(style)
    .setRequired(true)
    .setMaxLength(max);
}

function channelSelectRow(customId) {
  return new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder().setCustomId(customId).setPlaceholder('Choisis un salon').addChannelTypes(ChannelType.GuildText),
  );
}

// Convertit un hex ("#131313", "131313", "fff") en entier, ou null si invalide.
function parseHex(input) {
  let h = (input || '').trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{3}$/.test(h)) h = h.split('').map((c) => c + c).join('');
  return /^[0-9a-fA-F]{6}$/.test(h) ? parseInt(h, 16) : null;
}

// Champ de formulaire facultatif (le lien de l'image du panneau).
function optionalInput(id, label, placeholder, style, max) {
  return new TextInputBuilder()
    .setCustomId(id)
    .setLabel(label.slice(0, 45))
    .setPlaceholder(placeholder)
    .setStyle(style)
    .setRequired(false)
    .setMaxLength(max);
}

// Assistant partagé par /configticket (slot 1) et /configticket2 (slot 2).
export async function runTicketWizard(interaction, slot = 1) {
  const key = slot === 2 ? 'ticketConfig2' : 'ticketConfig';
  const cmdName = slot === 2 ? 'configticket2' : 'configticket';
  const guild = interaction.guild;
  const filter = (i) => i.user.id === interaction.user.id;
  const timeout = () => interaction.editReply({ content: `⏱️ Configuration annulée (délai dépassé). Relance \`/${cmdName}\`.`, components: [], embeds: [] });

  const config = {
    panelChannelId: null,
    staffRoleIds: [],
    transcriptChannelId: null,
    panelTitle: '',
    panelDescription: '',
    panelImage: null,
    panelColor: null,
    welcomeMode: 'same',
    commonWelcome: '',
    motifs: [],
    counter: 0,
    tickets: {},
  };

  // ===== 1/5 — Salon du panneau =====
  const step1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('cfg_create').setLabel('Créer un salon').setStyle(ButtonStyle.Success).setEmoji('➕'),
    new ButtonBuilder().setCustomId('cfg_existing').setLabel('Salon existant').setStyle(ButtonStyle.Primary).setEmoji('📁'),
  );
  const msg = await interaction.reply({
    content: '**1/5 — Salon du panneau**\nOù placer le panneau où les membres ouvriront un ticket ?',
    components: [step1],
    ephemeral: true,
    fetchReply: true,
  });

  const staffPrompt = '\n\n**2/5 — Rôle(s) staff**\nQui doit voir et gérer les tickets ?';
  const staffRow = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder().setCustomId('cfg_staff').setPlaceholder('Choisis le/les rôle(s) staff').setMinValues(1).setMaxValues(10),
  );

  try {
    const b1 = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 300_000, filter });
    if (b1.customId === 'cfg_create') {
      const ch = await guild.channels.create({ name: 'créer-un-ticket', type: ChannelType.GuildText });
      config.panelChannelId = ch.id;
      await b1.update({ content: `✅ Salon créé : <#${ch.id}>${staffPrompt}`, components: [staffRow] });
    } else {
      await b1.update({ content: 'Choisis le salon du panneau :', components: [channelSelectRow('cfg_panelchan')] });
      const s = await msg.awaitMessageComponent({ componentType: ComponentType.ChannelSelect, time: 300_000, filter });
      config.panelChannelId = s.values[0];
      await s.update({ content: `✅ Panneau dans <#${config.panelChannelId}>${staffPrompt}`, components: [staffRow] });
    }

    // ===== 2/5 — Rôles staff =====
    const roleSel = await msg.awaitMessageComponent({ componentType: ComponentType.RoleSelect, time: 300_000, filter });
    config.staffRoleIds = roleSel.values;
    const transcriptRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cfg_tcreate').setLabel('Créer un salon d’archives').setStyle(ButtonStyle.Success).setEmoji('➕'),
      new ButtonBuilder().setCustomId('cfg_texisting').setLabel('Salon existant').setStyle(ButtonStyle.Primary).setEmoji('📁'),
    );
    await roleSel.update({
      content: `✅ Staff : ${config.staffRoleIds.map((r) => `<@&${r}>`).join(' ')}\n\n**3/5 — Salon des transcriptions**\nOù archiver les tickets fermés ?`,
      components: [transcriptRow],
    });

    // ===== 3/5 — Salon des transcriptions =====
    const modeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cfg_same').setLabel('Même texte partout').setStyle(ButtonStyle.Primary).setEmoji('📋'),
      new ButtonBuilder().setCustomId('cfg_per').setLabel('Personnalisé par catégorie').setStyle(ButtonStyle.Secondary).setEmoji('✏️'),
    );
    const modePrompt = "\n\n**4/5 — Texte d'accueil dans les tickets**\nLe même texte pour toutes les catégories, ou un texte différent par catégorie ?";

    const b3 = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 300_000, filter });
    if (b3.customId === 'cfg_tcreate') {
      const ch = await guild.channels.create({
        name: 'ticket-transcripts',
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
          ...config.staffRoleIds.map((r) => ({ id: r, allow: [P.ViewChannel] })),
          { id: guild.members.me.id, allow: [P.ViewChannel, P.SendMessages, P.AttachFiles] },
        ],
      });
      config.transcriptChannelId = ch.id;
      await b3.update({ content: `✅ Archives : <#${ch.id}>${modePrompt}`, components: [modeRow] });
    } else {
      await b3.update({ content: 'Choisis le salon des transcriptions :', components: [channelSelectRow('cfg_tchan')] });
      const s = await msg.awaitMessageComponent({ componentType: ComponentType.ChannelSelect, time: 300_000, filter });
      config.transcriptChannelId = s.values[0];
      await s.update({ content: `✅ Archives dans <#${config.transcriptChannelId}>${modePrompt}`, components: [modeRow] });
    }

    // ===== 4/5 — Mode d'accueil → ouvre le formulaire principal =====
    const modeBtn = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 300_000, filter });
    config.welcomeMode = modeBtn.customId === 'cfg_per' ? 'per' : 'same';

    const modal = new ModalBuilder().setCustomId('cfg_modal').setTitle('5/5 — Contenu des tickets');
    const inputs = [
      textInput('title', 'Titre du panneau', '🎫 Ouvrir un ticket', TextInputStyle.Short, 100),
      textInput('desc', 'Texte du panneau (description)', 'Sélectionne un motif ci-dessous pour ouvrir un ticket.', TextInputStyle.Paragraph, 1000),
      textInput('motifs', 'Motifs — 1/ligne : Nom | emoji | desc', 'Support | 🎫 | Aide générale\nBug | 🐛 | Signaler un bug', TextInputStyle.Paragraph, 1000),
    ];
    if (config.welcomeMode === 'same') {
      inputs.push(textInput('welcome', "Texte d'accueil dans le ticket", 'Un membre du staff va te répondre au plus vite.', TextInputStyle.Paragraph, 1000));
    }
    inputs.push(optionalInput('image', 'Lien image du panneau (facultatif)', 'https://…​.png / .jpg / .gif — laisser vide si aucune', TextInputStyle.Short, 500));
    modal.addComponents(...inputs.map((i) => new ActionRowBuilder().addComponents(i)));
    await modeBtn.showModal(modal);

    const sub = await modeBtn.awaitModalSubmit({ time: 600_000, filter: (i) => i.customId === 'cfg_modal' && i.user.id === interaction.user.id });
    config.panelTitle = sub.fields.getTextInputValue('title');
    config.panelDescription = sub.fields.getTextInputValue('desc');
    config.motifs = parseMotifs(sub.fields.getTextInputValue('motifs'));
    if (config.welcomeMode === 'same') config.commonWelcome = sub.fields.getTextInputValue('welcome');
    const img = sub.fields.getTextInputValue('image')?.trim();
    config.panelImage = img && /^https?:\/\/\S+$/i.test(img) ? img : null;

    if (config.motifs.length === 0) {
      return sub.update({ content: `❌ Aucun motif valide détecté. Relance \`/${cmdName}\` (format : \`Nom | emoji | description\`).`, components: [], embeds: [] });
    }

    // ===== Couleur du panneau (bordure gauche de l'embed) =====
    const colorRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('cfg_color').setLabel('Choisir la couleur (hex)').setStyle(ButtonStyle.Primary).setEmoji('🎨'),
      new ButtonBuilder().setCustomId('cfg_colordefault').setLabel('Couleur par défaut').setStyle(ButtonStyle.Secondary),
    );
    await sub.update({
      content: "**Couleur du panneau** 🎨\nQuelle sera la couleur du hex (la bordure à gauche de l'embed) ?",
      components: [colorRow],
      embeds: [],
    });
    const cb = await msg.awaitMessageComponent({
      componentType: ComponentType.Button,
      time: 300_000,
      filter: (x) => (x.customId === 'cfg_color' || x.customId === 'cfg_colordefault') && x.user.id === interaction.user.id,
    });
    let colorInteraction = cb;
    if (cb.customId === 'cfg_color') {
      const cModal = new ModalBuilder()
        .setCustomId('cfg_colormodal')
        .setTitle('Couleur du panneau')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('hex')
              .setLabel('Couleur hex (avec ou sans #)')
              .setPlaceholder('#131313')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(7),
          ),
        );
      await cb.showModal(cModal);
      const cs = await cb.awaitModalSubmit({ time: 600_000, filter: (x) => x.customId === 'cfg_colormodal' && x.user.id === interaction.user.id });
      config.panelColor = parseHex(cs.fields.getTextInputValue('hex'));
      colorInteraction = cs;
    } else {
      config.panelColor = null;
    }

    // ===== Texte par catégorie (si personnalisé) =====
    const promptCategory = (inter, idx) => {
      const m = config.motifs[idx];
      const openBtn = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cfg_wt').setLabel(`Saisir le texte (${idx + 1}/${config.motifs.length})`).setStyle(ButtonStyle.Primary).setEmoji('✏️'),
      );
      return inter.update({ content: `**Texte d'accueil — catégorie ${idx + 1}/${config.motifs.length} : ${m.label}**\nClique pour le saisir.`, components: [openBtn], embeds: [] });
    };

    let lastInteraction = colorInteraction;
    if (config.welcomeMode === 'per') {
      await promptCategory(colorInteraction, 0);
      for (let i = 0; i < config.motifs.length; i++) {
        const wb = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 300_000, filter: (x) => x.customId === 'cfg_wt' && x.user.id === interaction.user.id });
        const wModal = new ModalBuilder()
          .setCustomId('cfg_wtmodal')
          .setTitle(`Texte — ${config.motifs[i].label}`.slice(0, 45))
          .addComponents(new ActionRowBuilder().addComponents(textInput('wt', `Accueil : ${config.motifs[i].label}`, 'Un membre du staff va te répondre.', TextInputStyle.Paragraph, 1000)));
        await wb.showModal(wModal);
        const ws = await wb.awaitModalSubmit({ time: 600_000, filter: (x) => x.customId === 'cfg_wtmodal' && x.user.id === interaction.user.id });
        config.motifs[i].welcome = ws.fields.getTextInputValue('wt');
        if (i < config.motifs.length - 1) await promptCategory(ws, i + 1);
        else lastInteraction = ws;
      }
    }

    // ===== Rôles d'accès par catégorie =====
    const catRoleRows = (i) => [
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId(`cfg_catrole_${i}`)
          .setPlaceholder(`Rôles qui voient « ${config.motifs[i].label} »`.slice(0, 100))
          .setMinValues(0)
          .setMaxValues(10),
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('cfg_catrole_skip').setLabel('Staff global (aucun rôle spécifique)').setStyle(ButtonStyle.Secondary),
      ),
    ];
    const catRolePrompt = (i) =>
      `**Rôles d'accès — catégorie ${i + 1}/${config.motifs.length} : ${config.motifs[i].label}**\n` +
      `Quel(s) rôle(s) peuvent **voir et gérer** les tickets de cette catégorie ?\n` +
      `_(ne rien choisir + « Staff global » = utiliser le staff configuré à l'étape 2)_`;

    await lastInteraction.update({ content: catRolePrompt(0), components: catRoleRows(0), embeds: [] });
    for (let i = 0; i < config.motifs.length; i++) {
      const sel = await msg.awaitMessageComponent({
        time: 300_000,
        filter: (x) => (x.customId === `cfg_catrole_${i}` || x.customId === 'cfg_catrole_skip') && x.user.id === interaction.user.id,
      });
      config.motifs[i].roleIds = sel.customId === 'cfg_catrole_skip' ? [] : sel.values ?? [];
      if (i < config.motifs.length - 1) await sel.update({ content: catRolePrompt(i + 1), components: catRoleRows(i + 1), embeds: [] });
      else await sel.update({ content: '⏳ Finalisation…', components: [], embeds: [] });
    }

    // ===== Finalisation : catégories + sauvegarde + panneau =====
    await createCategories(guild, config);
    setTicketConfig(guild.id, config, key);
    const panelChannel = guild.channels.cache.get(config.panelChannelId) ?? (await guild.channels.fetch(config.panelChannelId));
    await panelChannel.send(buildTicketPanel(config, slot));

    await interaction.editReply({
      content:
        `✅ **Système de tickets ${slot === 2 ? '2 ' : ''}configuré !**\n` +
        `• Panneau publié dans <#${config.panelChannelId}>\n` +
        `• Archives : <#${config.transcriptChannelId}>\n` +
        `• Staff global : ${config.staffRoleIds.map((r) => `<@&${r}>`).join(' ')}\n` +
        `• Image : ${config.panelImage ? '✅ ajoutée' : 'aucune'}\n` +
        `• Couleur : ${config.panelColor != null ? `#${config.panelColor.toString(16).padStart(6, '0')}` : 'par défaut'}\n` +
        `• Catégories :\n${config.motifs
          .map((m) => `   - **${m.label}** → ${m.roleIds?.length ? m.roleIds.map((r) => `<@&${r}>`).join(' ') : 'staff global'}`)
          .join('\n')}`,
      components: [],
      embeds: [],
    });
  } catch (err) {
    if (err?.code === 'InteractionCollectorError' || err?.name === 'Error') return timeout().catch(() => {});
    console.error(err);
    return interaction.editReply({ content: '❌ Une erreur est survenue pendant la configuration.', components: [], embeds: [] }).catch(() => {});
  }
}

export default {
  data: new SlashCommandBuilder()
    .setName('configticket')
    .setDescription('Configurer le système de tickets (assistant guidé).')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setDMPermission(false),

  execute(interaction) {
    return runTicketWizard(interaction, 1);
  },
};
