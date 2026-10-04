import {
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
  EmbedBuilder,
} from 'discord.js';
import { getGreetConfig, setGreetConfig, getGreetEmbed, getPartner } from './store.js';

export const TEMPLATE_HELP =
  'Templates : `[@]` (mention/pseudo) · `[user]` (pseudo) · `[tag]` (identifiant complet) · `[server]` (nom du serveur) · `[count]` (nombre de membres, bots exclus) · `[nump]` (nombre de partenariats) · `[date]`';

// Remplace les templates dans le texte. `count` = nombre de membres humains.
function applyTemplates(text, { mention, username, tag, guild, count }) {
  return text
    .replace(/\[@\]/gi, mention)
    .replace(/\[user\]/gi, username)
    .replace(/\[tag\]/gi, tag)
    .replace(/\[server\]/gi, guild.name)
    .replace(/\[count\]/gi, String(count ?? guild.memberCount))
    .replace(/\[nump\]/gi, String(getPartner(guild.id).total ?? 0))
    .replace(/\[date\]/gi, new Date().toLocaleDateString('fr-FR'));
}

// Applique les templates aux textes d'un embed stocké, en respectant les
// limites de Discord. Les mentions ne s'affichent que dans la description et
// les valeurs de champs : ailleurs (titre, auteur, pied de page), [@] devient le pseudo.
function templateEmbed(data, vars) {
  const plain = { ...vars, mention: vars.username };
  const t = (s, max, v = vars) => (s ? applyTemplates(s, v).slice(0, max) : s);
  const e = structuredClone(data);
  e.title = t(e.title, 256, plain);
  e.description = t(e.description, 4096);
  if (e.author) e.author.name = t(e.author.name, 256, plain);
  if (e.footer) e.footer.text = t(e.footer.text, 2048, plain);
  if (e.fields) for (const f of e.fields) Object.assign(f, { name: t(f.name, 256, plain), value: t(f.value, 1024) });
  return e;
}

// Variables des templates pour un membre.
async function templateVars(guild, user, isWelcome) {
  return {
    mention: isWelcome ? `<@${user.id}>` : `**${user.tag}**`, // un membre parti ne peut plus être ping
    username: user.username,
    tag: user.tag,
    guild,
    count: await humanCount(guild),
  };
}

// Embed de /embed envoyé à la main : variables remplacées avec la personne qui l'envoie.
export async function renderEmbedFor(guild, user, data) {
  return templateEmbed(data, await templateVars(guild, user, true));
}

// Nombre de membres humains (bots exclus). Utilise le cache s'il est complet,
// sinon récupère la liste ; repli sur memberCount en cas d'échec.
async function humanCount(guild) {
  try {
    const members = guild.members.cache.size >= guild.memberCount ? guild.members.cache : await guild.members.fetch();
    return members.filter((m) => !m.user.bot).size;
  } catch {
    return guild.memberCount;
  }
}

async function textChannel(guild, channelId) {
  if (!channelId) return null;
  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  return channel?.isTextBased() ? channel : null;
}

// Envoie le message de bienvenue ('welcome') ou de départ ('leave') : le
// message texte (/bienvenue, /quitte) et l'embed (/embed) sont indépendants,
// chacun envoyé dans son propre salon s'il est configuré.
export async function sendGreeting(guild, type, member) {
  const cfg = getGreetConfig(guild.id, type);
  const embedCfg = getGreetEmbed(guild.id, type);
  const channel = cfg?.message ? await textChannel(guild, cfg.channelId) : null;
  const embedChannel = embedCfg?.embed ? await textChannel(guild, embedCfg.channelId) : null;
  if (!channel && !embedChannel) return;

  const user = member.user;
  const isWelcome = type === 'welcome';
  const vars = await templateVars(guild, user, isWelcome);

  if (channel) {
    const rolePing = cfg.pingRoleId ? `<@&${cfg.pingRoleId}> ` : '';
    const body = applyTemplates(cfg.message, vars);
    const payload = {
      content: `${rolePing}${body}`.slice(0, 2000),
      allowedMentions: {
        users: isWelcome ? [user.id] : [],
        roles: cfg.pingRoleId ? [cfg.pingRoleId] : [],
      },
    };
    if (cfg.gifUrl) {
      payload.embeds = [new EmbedBuilder().setColor(isWelcome ? 0x57f287 : 0xed4245).setImage(cfg.gifUrl)];
    }
    await channel.send(payload).catch(() => {});
  }

  // Une mention dans un embed ne notifie pas : si [@] est utilisé, le membre
  // est aussi mentionné au-dessus de l'embed.
  if (embedChannel) {
    const pingUser = isWelcome && JSON.stringify(embedCfg.embed).includes('[@]');
    await embedChannel
      .send({
        ...(pingUser ? { content: `<@${user.id}>` } : {}),
        embeds: [templateEmbed(embedCfg.embed, vars)],
        allowedMentions: { users: pingUser ? [user.id] : [], roles: [] },
      })
      .catch(() => {});
  }
}

// Assistant de configuration commun à /bienvenue et /quitte.
export async function runGreetingWizard(interaction, type) {
  const guild = interaction.guild;
  const filter = (i) => i.user.id === interaction.user.id;
  const isWelcome = type === 'welcome';
  const prefix = isWelcome ? 'cfgb' : 'cfgq';
  const title = isWelcome ? 'bienvenue' : 'départ';
  const defaultChanName = isWelcome ? 'bienvenue' : 'au-revoir';
  const cfg = { channelId: null, message: '', gifUrl: null, pingRoleId: null };

  const writeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}_write`).setLabel('Rédiger le message').setStyle(ButtonStyle.Primary).setEmoji('✏️'),
  );
  const writePrompt = `\n\n**2/3 — Message**\n${TEMPLATE_HELP}\n\nClique pour rédiger le message et (optionnel) coller un lien de GIF.`;

  const step1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${prefix}_create`).setLabel('Créer un salon').setStyle(ButtonStyle.Success).setEmoji('➕'),
    new ButtonBuilder().setCustomId(`${prefix}_existing`).setLabel('Salon existant').setStyle(ButtonStyle.Primary).setEmoji('📁'),
  );
  const msg = await interaction.reply({
    content: `**1/3 — Salon des messages de ${title}**\nOù envoyer les messages de ${title} ?`,
    components: [step1],
    ephemeral: true,
    fetchReply: true,
  });

  try {
    // ===== 1/3 — Salon =====
    const b1 = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 300_000, filter });
    if (b1.customId === `${prefix}_create`) {
      const ch = await guild.channels.create({ name: defaultChanName, type: ChannelType.GuildText });
      cfg.channelId = ch.id;
      await b1.update({ content: `✅ Salon créé : <#${ch.id}>${writePrompt}`, components: [writeRow] });
    } else {
      await b1.update({
        content: 'Choisis le salon :',
        components: [
          new ActionRowBuilder().addComponents(
            new ChannelSelectMenuBuilder().setCustomId(`${prefix}_chan`).setPlaceholder('Choisis un salon').addChannelTypes(ChannelType.GuildText),
          ),
        ],
      });
      const s = await msg.awaitMessageComponent({ componentType: ComponentType.ChannelSelect, time: 300_000, filter });
      cfg.channelId = s.values[0];
      await s.update({ content: `✅ Salon : <#${cfg.channelId}>${writePrompt}`, components: [writeRow] });
    }

    // ===== 2/3 — Message (+ GIF optionnel) via modal =====
    const wb = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 300_000, filter });
    const modal = new ModalBuilder()
      .setCustomId(`${prefix}_modal`)
      .setTitle(`Message de ${title}`)
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('message')
            .setLabel('Message')
            .setPlaceholder('Bienvenue [@] sur [server] ! Tu es le [count]e membre 🎉')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(1500),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('gif')
            .setLabel('Lien du GIF (optionnel)')
            .setPlaceholder('https://…​.gif — laisser vide si aucun')
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setMaxLength(400),
        ),
      );
    await wb.showModal(modal);

    const sub = await wb.awaitModalSubmit({ time: 600_000, filter: (i) => i.customId === `${prefix}_modal` && i.user.id === interaction.user.id });
    cfg.message = sub.fields.getTextInputValue('message');
    const gif = sub.fields.getTextInputValue('gif')?.trim();
    cfg.gifUrl = gif && /^https?:\/\/\S+$/.test(gif) ? gif : null;

    // ===== 3/3 — Ping d'un rôle en plus ? =====
    const pingRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`${prefix}_pingyes`).setLabel('Oui, ping un rôle').setStyle(ButtonStyle.Success).setEmoji('🔔'),
      new ButtonBuilder().setCustomId(`${prefix}_pingno`).setLabel('Non').setStyle(ButtonStyle.Secondary),
    );
    const gifNote = cfg.gifUrl ? `\n🖼️ GIF : ${cfg.gifUrl}` : gif ? '\n⚠️ Lien de GIF ignoré (URL invalide).' : '';
    await sub.update({
      content: `✅ Message enregistré.${gifNote}\n\n**3/3 — Ping supplémentaire**\nEn plus de l’utilisateur, faut-il mentionner un rôle ?`,
      components: [pingRow],
      embeds: [],
    });

    const pb = await msg.awaitMessageComponent({ componentType: ComponentType.Button, time: 300_000, filter });
    if (pb.customId === `${prefix}_pingyes`) {
      await pb.update({
        content: 'Choisis le rôle à mentionner :',
        components: [
          new ActionRowBuilder().addComponents(
            new RoleSelectMenuBuilder().setCustomId(`${prefix}_role`).setPlaceholder('Choisis un rôle').setMinValues(1).setMaxValues(1),
          ),
        ],
      });
      const rs = await msg.awaitMessageComponent({ componentType: ComponentType.RoleSelect, time: 300_000, filter });
      cfg.pingRoleId = rs.values[0];
      setGreetConfig(guild.id, type, cfg);
      await rs.update({ content: buildSummary(title, cfg), components: [], embeds: [] });
    } else {
      setGreetConfig(guild.id, type, cfg);
      await pb.update({ content: buildSummary(title, cfg), components: [], embeds: [] });
    }
  } catch (err) {
    console.error(err);
    return interaction.editReply({ content: '⏱️ Configuration annulée (délai dépassé ou erreur). Relance la commande.', components: [], embeds: [] }).catch(() => {});
  }
}

function buildSummary(title, cfg) {
  return (
    `✅ **Message de ${title} configuré !**\n` +
    `• Salon : <#${cfg.channelId}>\n` +
    `• GIF : ${cfg.gifUrl ? 'oui' : 'non'}\n` +
    `• Ping rôle : ${cfg.pingRoleId ? `<@&${cfg.pingRoleId}>` : 'non'}\n` +
    `• Message :\n> ${cfg.message.replaceAll('\n', '\n> ')}`
  );
}
