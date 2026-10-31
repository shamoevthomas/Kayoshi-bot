import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getPokemonGame, setPokemonGame } from './store.js';
import { POKEMON } from './pokemondata.js';
import { POKEDEX } from './pokedexdata.js';
import { pokemonImages, pokeKey, matchesPokemon } from './pokemonart.js';

// Salon Pokémon (/pokemon activer) : une silhouette à la fois, sans fin. Le premier qui écrit le nom (français ou
// anglais) gagne 1 point ; le Pokémon est dévoilé avec sa description du Pokédex et les points du joueur, puis le
// suivant arrive. 1 chance sur 64 qu'il soit brillant ✨. Boutons : ❓ indice, ⏭️ passer, 👑 classement,
// 📕 Pokédex du joueur, ✨ ses brillants. Le Pokémon en cours est gardé : la partie reprend après un redémarrage.
const SHINY_CHANCE = 1 / 64;
const MAX_HINTS = 3;
const SKIP_AFTER_MS = 15_000;
const RECENT = 50;
const COLOR = 0xe3350d;
const TOTAL = POKEMON.length;
const busy = new Set(); // serveurs dont le Pokémon est en train de changer
const imageCache = new Map(); // guildId → { id, shiny, reveal } : image du Pokémon en cours
const place = (n) => (n === 1 ? '1ᵉʳ' : `${n}ᵉ`);
const quiet = { allowedMentions: { parse: [] } };

const byId = (id) => POKEMON[id - 1];
const config = (guildId) => getPokemonGame(guildId);
const save = (guildId, cfg) => setPokemonGame(guildId, cfg);
const scoreOf = (cfg, userId) => cfg.scores?.[userId] ?? { points: 0, dex: [], shinies: [] };
function rankOf(cfg, userId) {
  const sorted = Object.entries(cfg.scores ?? {}).sort((a, b) => b[1].points - a[1].points);
  const i = sorted.findIndex(([id]) => id === userId);
  return i < 0 ? null : i + 1;
}

// Indice : 1 = types et génération, 2 = première lettre et longueur, 3 = une lettre sur deux.
function hintText(pokemon, level) {
  const [, fr, , gen, types] = pokemon;
  const letters = [...fr];
  const lines = [`💡 Type **${types}** · génération ${gen}`];
  if (level >= 2) {
    const shown = letters.map((c, i) => (/[^\p{L}\p{N}]/u.test(c) ? c : i === 0 || (level >= 3 && i % 2 === 0) ? c : '_'));
    lines.push(`💡 \`${shown.join(' ')}\` (${pokeKey(fr).length} lettres)`);
  }
  return lines.slice(0, level).join('\n');
}

function buttons(disabled = false) {
  const b = (id, emoji, label, style = ButtonStyle.Secondary) =>
    new ButtonBuilder().setCustomId(`pkm:${id}`).setEmoji(emoji).setLabel(label).setStyle(style).setDisabled(disabled);
  return new ActionRowBuilder().addComponents(
    b('hint', '❓', 'Indice'),
    b('skip', '⏭️', 'Passer'),
    b('top', '👑', 'Classement'),
    b('dex', '📕', 'Pokédex'),
    b('shiny', '✨', 'Brillants'),
  );
}

function silhouetteEmbed(cfg) {
  const current = cfg.current;
  const pokemon = byId(current.id);
  return new EmbedBuilder()
    .setColor(COLOR)
    .setAuthor({ name: 'Quel est ce Pokémon ?' })
    .setDescription(
      'Écris le nom du Pokémon pour le deviner (en français ou en anglais).' +
        (current.hints ? `\n\n${hintText(pokemon, current.hints)}` : '') +
        (cfg.gen ? `\n-# Génération ${cfg.gen} seulement.` : ''),
    )
    .setThumbnail('attachment://silhouette.png');
}

// Tire et poste le Pokémon suivant (sans ceux sortis récemment).
async function postNext(guild, channel) {
  const cfg = config(guild.id);
  if (!cfg?.channelId) return;
  const recent = cfg.recent ?? [];
  const pool = POKEMON.filter((p) => (!cfg.gen || p[3] === cfg.gen) && !recent.includes(p[0]));
  const pokemon = (pool.length ? pool : POKEMON)[Math.floor(Math.random() * (pool.length || TOTAL))];
  const shiny = Math.random() < SHINY_CHANCE;
  const images = await pokemonImages(pokemon[0], { shiny });
  if (!images) return;
  imageCache.set(guild.id, { id: pokemon[0], shiny, reveal: images.reveal });
  const next = { ...config(guild.id), recent: [...recent, pokemon[0]].slice(-RECENT) };
  next.current = { id: pokemon[0], shiny, at: Date.now(), hints: 0, messageId: null };
  const message = await channel
    .send({ embeds: [silhouetteEmbed(next)], files: [{ attachment: images.silhouette, name: 'silhouette.png' }], components: [buttons()], ...quiet })
    .catch(() => null);
  if (!message) return;
  next.current.messageId = message.id;
  save(guild.id, next);
}

// Image du Pokémon dévoilé (gardée depuis son tirage, sinon redessinée après un redémarrage).
async function revealImage(guildId, current) {
  const cached = imageCache.get(guildId);
  if (cached?.id === current.id) return cached.reveal;
  return (await pokemonImages(current.id, { shiny: current.shiny }))?.reveal ?? null;
}

// Pokémon dévoilé : trouvé par `winner` (points), ou passé par `skipper`.
async function reveal(guild, channel, cfg, { winner = null, skipper = null }) {
  const current = cfg.current;
  const [id, fr, en, gen, types] = byId(current.id);
  const about = `**${fr}**${fr !== en ? ` (anglais : ${en})` : ''} est un Pokémon de type ${types} introduit dans la génération ${gen}.` + (POKEDEX[id - 1] ? `\n${POKEDEX[id - 1]}` : '');
  const shinyText = current.shiny ? ' ✨ **Brillant !**' : '';
  const embed = new EmbedBuilder()
    .setColor(winner ? 0x2ecc71 : 0x95a5a6)
    .setAuthor({ name: 'Quel est ce Pokémon ?' })
    .setThumbnail('attachment://pokemon.png')
    .setFooter({ text: `n°${id} · 👑 classement, 📕 Pokédex et ✨ brillants : boutons sous le Pokémon suivant` });
  if (winner) {
    const score = scoreOf(cfg, winner.id);
    embed
      .setDescription(`${winner} C’est **${fr}** !${shinyText}\n\n${about}`)
      .addFields({
        name: 'Points',
        value: `\`\`\`\nServeur : ${score.points}\nPokédex : ${score.dex.length}/${TOTAL}\nBrillants : ${score.shinies.length}\nClassement : ${place(rankOf(cfg, winner.id))}\n\`\`\``,
      });
  } else embed.setDescription(`⏭️ Passé par ${skipper}. C’était **${fr}** !${shinyText}\n\n${about}`);
  const image = await revealImage(guild.id, current);
  await channel.send({ embeds: [embed], files: image ? [{ attachment: image, name: 'pokemon.png' }] : [], ...quiet }).catch(() => {});
  // L'ancienne silhouette garde son image mais perd ses boutons.
  if (current.messageId) await channel.messages.edit(current.messageId, { components: [] }).catch(() => {});
}

// Message dans le salon Pokémon : une tentative. Renvoie true si le message a été pris par le jeu (pas d'XP).
export async function handlePokemonChannelMessage(message) {
  if (!message.guild || message.author.bot) return false;
  const cfg = config(message.guild.id);
  if (!cfg?.channelId || message.channelId !== cfg.channelId) return false;
  const text = message.content.trim();
  if (!text || /^[+./!?]/.test(text)) return false; // commandes : traitées normalement
  if (!cfg.current || busy.has(message.guild.id)) return true;
  if (!matchesPokemon(text, byId(cfg.current.id))) return true;

  busy.add(message.guild.id);
  try {
    const score = scoreOf(cfg, message.author.id);
    const id = cfg.current.id;
    const updated = {
      points: score.points + 1,
      dex: score.dex.includes(id) ? score.dex : [...score.dex, id],
      shinies: cfg.current.shiny ? [...score.shinies, id] : score.shinies,
    };
    const next = { ...cfg, scores: { ...(cfg.scores ?? {}), [message.author.id]: updated } };
    save(message.guild.id, next);
    await message.react(cfg.current.shiny ? '✨' : '✅').catch(() => {});
    await reveal(message.guild, message.channel, next, { winner: message.author });
    await postNext(message.guild, message.channel);
  } finally {
    busy.delete(message.guild.id);
  }
  return true;
}

// Boutons pkm:<action>.
export async function handlePokemonGameInteraction(interaction) {
  const action = interaction.customId.split(':')[1];
  const { guild, user } = interaction;
  const cfg = config(guild.id);
  if (!cfg?.channelId) return interaction.reply({ content: '⌛ Le salon Pokémon n’est plus actif.', ephemeral: true });
  const score = scoreOf(cfg, user.id);

  if (action === 'top') {
    const top = Object.entries(cfg.scores ?? {}).sort((a, b) => b[1].points - a[1].points).slice(0, 10);
    const medals = ['🥇', '🥈', '🥉'];
    const lines = top.map(([id, s], i) => `${medals[i] ?? `**${i + 1}.**`} <@${id}> — **${s.points}** pt · 📕 ${s.dex.length}/${TOTAL}${s.shinies.length ? ` · ✨ ${s.shinies.length}` : ''}`);
    return interaction.reply({
      embeds: [new EmbedBuilder().setColor(COLOR).setTitle('👑 Classement Pokémon du serveur').setDescription(lines.join('\n') || 'Personne n’a encore trouvé de Pokémon.')],
      ephemeral: true,
    });
  }
  if (action === 'dex') {
    const last = score.dex.slice(-10).reverse().map((n) => byId(n)[1]);
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(COLOR)
          .setTitle(`📕 Pokédex de ${interaction.member?.displayName ?? user.username}`)
          .setDescription(
            `**${score.dex.length}/${TOTAL}** Pokémon trouvés (${Math.floor((score.dex.length / TOTAL) * 100)} %)\n` +
              `Points : **${score.points}** · Classement : **${score.points ? place(rankOf(cfg, user.id)) : '—'}** · Brillants : **${score.shinies.length}**` +
              (last.length ? `\n\nDerniers trouvés : ${last.join(', ')}` : ''),
          ),
      ],
      ephemeral: true,
    });
  }
  if (action === 'shiny') {
    const names = score.shinies.map((n) => `✨ ${byId(n)[1]}`);
    return interaction.reply({
      content: names.length ? `Tes Pokémon brillants (${names.length}) :\n${names.join(' · ')}` : '✨ Tu n’as pas encore trouvé de Pokémon brillant (1 chance sur 64 à chaque Pokémon).',
      ephemeral: true,
    });
  }
  // Indice et passer : seulement sur la silhouette en cours.
  if (!cfg.current || interaction.message.id !== cfg.current.messageId) {
    return interaction.reply({ content: '⌛ Ce Pokémon a déjà été trouvé : regarde le suivant.', ephemeral: true });
  }
  if (action === 'hint') {
    if (cfg.current.hints >= MAX_HINTS) return interaction.reply({ content: '💡 Tous les indices sont déjà donnés !', ephemeral: true });
    const next = { ...cfg, current: { ...cfg.current, hints: cfg.current.hints + 1 } };
    save(guild.id, next);
    return interaction.update({ embeds: [silhouetteEmbed(next)] });
  }
  if (action === 'skip') {
    const wait = SKIP_AFTER_MS - (Date.now() - cfg.current.at);
    if (wait > 0) return interaction.reply({ content: `⏳ Laisse une chance aux autres : tu pourras passer dans ${Math.ceil(wait / 1000)} s.`, ephemeral: true });
    if (busy.has(guild.id)) return interaction.deferUpdate();
    busy.add(guild.id);
    try {
      await interaction.deferUpdate();
      await reveal(guild, interaction.channel, cfg, { skipper: user });
      await postNext(guild, interaction.channel);
    } finally {
      busy.delete(guild.id);
    }
  }
  return null;
}

// /pokemon activer : le salon, la génération éventuelle, et le premier Pokémon.
export async function startPokemonChannel(guild, channel, gen) {
  const old = config(guild.id) ?? {};
  // Ancienne silhouette ailleurs : plus de boutons.
  if (old.channelId && old.current?.messageId) {
    await guild.channels.cache.get(old.channelId)?.messages.edit(old.current.messageId, { components: [] }).catch(() => {});
  }
  save(guild.id, { ...old, channelId: channel.id, gen: gen ?? null, current: null });
  await postNext(guild, channel);
  return Boolean(config(guild.id)?.current);
}

export async function stopPokemonChannel(guild) {
  const cfg = config(guild.id);
  if (!cfg?.channelId) return false;
  if (cfg.current?.messageId) await guild.channels.cache.get(cfg.channelId)?.messages.edit(cfg.current.messageId, { components: [] }).catch(() => {});
  save(guild.id, { ...cfg, channelId: null, current: null });
  return true;
}

// Permissions dont le bot a besoin dans le salon.
export const NEEDED = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.AddReactions,
];
