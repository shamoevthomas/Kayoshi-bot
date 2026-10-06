import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import { Colors } from '../../lib/logger.js';

// Catalogue des commandes, regroupées par thème. Chaque entrée = une ligne
// « **/commande** — description ». Les sous-commandes sont résumées sur la même
// ligne (`config` `on` `off`…) pour rester lisible.
const CATEGORIES = [
  {
    title: '🔨 Modération',
    lines: [
      ['/ban', 'Bannir un membre'],
      ['/unban', 'Débannir un utilisateur via son ID'],
      ['/kick', 'Expulser un membre du serveur'],
      ['/mute', 'Rendre un membre muet (timeout) pour une durée'],
      ['/unmute', 'Retirer le mute (timeout) d’un membre'],
      ['/warn', 'Donner un avertissement à un membre'],
      ['/warnings', 'Voir les avertissements d’un membre'],
      ['/delwarn', 'Retirer un avertissement précis'],
      ['/clearwarns', 'Effacer TOUS les avertissements d’un membre'],
      ['/jail · /unjail', 'Jail un membre (perd un rôle, gagne le rôle de jail) / le libérer (retrouve son rôle)'],
      ['/jailconfig', 'Choisir le rôle donné et le rôle retiré par /jail'],
      ['/derank','Retirer un rôle à un membre et le prévenir en MP'],
      ['/sanction', 'Créer le salon qui regroupe toutes les sanctions (au lieu des logs)'],
      ['/purge', 'Supprimer des messages dans ce salon (par lots)'],
      ['/lock · /unlock', 'Verrouiller / déverrouiller l’écriture dans ce salon'],
      ['/slowmode', 'Régler le mode lent du salon (0 = off)'],
      ['/nick', 'Changer ou réinitialiser le pseudo d’un membre'],
      ['/lockpseudo · /unlockpseudo', 'Imposer un pseudo à un membre (il ne peut plus se renommer, sauf staff) / le libérer'],
      ['/listepseudo', 'Membres qui n’ont pas le droit de se renommer'],
      ['/role', 'Ajouter ou retirer un rôle à un membre (bascule)'],
      ['/addrole', 'Ajouter un rôle à un membre'],
      ['/massrole', '`donner` `retirer` un rôle à plusieurs membres'],
    ],
  },
  {
    title: '🛡️ Arrivées & vérification',
    lines: [
      ['/configverif', 'Configurer la vérification anti-bot (captcha)'],
      ['/passer-verif', 'Valider manuellement la vérification d’un membre'],
      ['/verif-all', 'Valider la vérification de tous les non-vérifiés'],
      ['/bienvenue', 'Configurer le message de bienvenue (arrivées)'],
      ['/quitte', 'Configurer le message de départ'],
      ['/bilan', 'Bilan des arrivées et départs sur une période'],
    ],
  },
  {
    title: '🎫 Tickets',
    lines: [
      ['/configticket', 'Configurer le système de tickets (assistant guidé)'],
      ['/configticket2', 'Configurer un 2ᵉ système de tickets indépendant'],
      ['/ajouterroleticket', 'Ajouter un rôle au staff des tickets (accès + mention à l’ouverture) — système 1 ou 2'],
      ['/retirerroleticket', 'Retirer un rôle du staff des tickets — système 1 ou 2'],
      ['/modifiermotifticket', 'Changer le titre d’un motif de ticket existant — système 1 ou 2'],
      ['/modifierdescriptionticket', 'Changer la description d’un motif de ticket (menu déroulant) — système 1 ou 2'],
      ['/modifdescticketopen', 'Changer le texte affiché à l’ouverture d’un ticket, pour un motif — système 1 ou 2'],
      ['/avisticket', '`activer` `desactiver` `voir` — avis (⭐) à la fermeture (ticket 1, 2 ou les deux)'],
    ],
  },
  {
    title: '📨 Invitations',
    lines: [
      ['/inviteconfig', '`salon` `desactiver` — salon de suivi des invitations'],
      ['/invitations', 'Suivi des invitations d’un membre (total, détail, palier)'],
      ['/inviteleaderboard', 'Classement des meilleurs parrains'],
      ['/invitebonus', '`ajouter` `retirer` des invitations bonus'],
      ['/invitrank', '`ajouter` `liste` `retirer` — paliers de rôles selon les invit.'],
    ],
  },
  {
    title: '🎭 Rôles automatiques',
    lines: [
      ['/statut', '`ajouter` `liste` `retirer` — rôle selon un mot-clé du statut'],
      ['/statut-role', '`activer` `desactiver` `voir` — rôle selon un texte du statut'],
      ['/tagrole', '`activer` `desactiver` `voir` — rôle si le tag du serveur est porté'],
      ['/antirole', '`ajouter` `liste` `retirer` — rôles incompatibles (ex : Actif retire Nouveau)'],
    ],
  },
  {
    title: '📡 Suivi réseaux sociaux',
    lines: [
      ['/twitch', '`ajouter` `liste` `retirer` — annoncer les lives Twitch'],
      ['/tiktokeur', '`ajouter` `liste` `retirer` — nouvelles vidéos TikTok'],
      ['/youtubeur', '`ajouter` `liste` `retirer` — nouvelles vidéos YouTube'],
    ],
  },
  {
    title: '⚙️ Salons & systèmes',
    lines: [
      ['/configvocal', 'Salons vocaux temporaires (Join to Create)'],
      ['/join', 'Faire rejoindre un salon vocal au bot (il y reste, même vide)'],
      ['/configstat', 'Salon du classement des membres les plus actifs'],
      ['/configlien', 'Blocage des liens (par salon et par rôle)'],
      ['/antispam', '`activer` `desactiver` `voir` — anti-spam (+ mute 1 h si spam multi-salons)'],
      ['/one-message', '`activer` `desactiver` `liste` — messages supprimés auto'],
      ['/configboost', 'Message quand quelqu’un boost le serveur'],
      ['/bremind', 'Activer / désactiver le rappel de bump Disboard (2 h après chaque /bump)'],
      ['/bremind-edit', 'Message de rappel, rôle à mentionner, message après avoir bump'],
      ['/coiffeur', 'Répond « feur » quand un message finit par « quoi »'],
      ['/reset', 'Supprime un salon et le recrée à l’identique'],
      ['/log', 'Configurer le salon des logs du serveur'],
    ],
  },
  {
    title: '🎉 Giveaways',
    lines: [['/gw', '`start` `end` `reroll` `retirer-participant` — gérer les giveaways']],
  },
  {
    title: '💬 Communication & utilitaires',
    lines: [
      ['/announce', 'Publier une annonce dans un salon précis'],
      ['/embed', 'Créer un embed (aperçu modifiable) : envoi, partenariat (rôle mentionné, salon partenariat), ou message de bienvenue / départ'],
      ['/nump', 'Nombre de partenariats effectués par un membre (rang + total du serveur)'],
      ['/say', 'Faire parler le bot dans ce salon'],
      ['/save', 'Messages sauvegardés (5 emplacements)'],
      ['/copyemoji', 'Copier des emojis d’un autre serveur sur celui-ci'],
      ['/serverinfo', 'Statistiques du serveur'],
      ['/userinfo', 'Fiche d’un membre'],
      ['/pseudo', 'Envoie le pseudo d’un membre'],
      ['/ping', 'Latence du bot'],
      ['/help', 'Affiche cette liste'],
    ],
  },
];

// Limites Discord : 1024 car/champ, ~6000 car/embed, 25 champs/embed, 10 embeds/message.
const MAX_FIELD = 1024;
const MAX_EMBED = 5500; // marge sous 6000
const MAX_FIELDS = 25;

// Transforme une catégorie en un ou plusieurs champs (découpe si > 1024 car).
function categoryToFields(cat) {
  const fields = [];
  let buf = '';
  for (const [name, desc] of cat.lines) {
    const line = `**${name}** — ${desc}\n`;
    if (buf.length + line.length > MAX_FIELD) {
      fields.push({ name: fields.length ? `${cat.title} (suite)` : cat.title, value: buf });
      buf = '';
    }
    buf += line;
  }
  if (buf) fields.push({ name: fields.length ? `${cat.title} (suite)` : cat.title, value: buf });
  return fields;
}

// Répartit tous les champs sur plusieurs embeds en respectant les limites.
function buildEmbeds() {
  const allFields = CATEGORIES.flatMap(categoryToFields);
  const embeds = [];
  let fields = [];
  let size = 0;

  const flush = () => {
    if (!fields.length) return;
    embeds.push(new EmbedBuilder().setColor(Colors.role).addFields(fields));
    fields = [];
    size = 0;
  };

  for (const f of allFields) {
    const cost = f.name.length + f.value.length;
    if (fields.length >= MAX_FIELDS || size + cost > MAX_EMBED) flush();
    fields.push(f);
    size += cost;
  }
  flush();

  if (embeds.length) {
    embeds[0]
      .setTitle('📖 Commandes du bot')
      .setDescription('Voici toutes les commandes disponibles, par thème.');
    embeds[embeds.length - 1].setFooter({
      text: 'Astuce : tape « / » dans le champ de message pour voir les options de chaque commande.',
    });
  }
  return embeds;
}

export default {
  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Affiche la liste de toutes les commandes du bot.')
    .setDMPermission(false),

  async execute(interaction) {
    // Jusqu'à 10 embeds/message : largement suffisant ici.
    await interaction.reply({ embeds: buildEmbeds(), ephemeral: true });
  },
};
