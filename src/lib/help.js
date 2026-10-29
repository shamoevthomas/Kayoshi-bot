import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder } from 'discord.js';
import { Colors } from './logger.js';

// /help : un menu déroulant (« help_menu ») avec une page par catégorie. Chaque catégorie a une
// courte présentation de son fonctionnement (about) puis ses commandes, une par ligne
// « **/commande** — description » (sous-commandes résumées : `config` `on` `off`…).
// Le menu est géré par le routeur d'interactionCreate : il marche aussi après un redémarrage.
const CATEGORIES = [
  {
    key: 'moderation',
    emoji: '🔨',
    name: 'Modération',
    summary: 'Sanctions, avertissements, salons et pseudos',
    about:
      'Pour sanctionner et encadrer les membres. Les sanctions sont envoyées en MP au membre (avec ou sans ton pseudo) ' +
      'et loggées dans le salon des sanctions.',
    lines: [
      ['/ban', 'Bannir un membre, ou un utilisateur absent du serveur avec son `id`'],
      ['/unban', 'Débannir un utilisateur via son ID, ou tout le monde avec `tout` (administrateurs, avec confirmation)'],
      ['/kick', 'Expulser un membre du serveur'],
      ['/mute', 'Rendre un membre muet (timeout) pour une durée'],
      ['/unmute', 'Retirer le mute (timeout) d’un membre'],
      ['/warn', 'Donner un avertissement à un membre'],
      ['/delwarn', 'Retirer un avertissement précis (son numéro est dans /casier), ou tous avec `tout`'],
      ['/casier', 'Sanctions d’un membre, ou de tout le serveur sans membre (avertissements avec leur numéro, mutes, kicks, bans, deranks), avec dates et modérateurs ; option `sanction` pour un seul type'],
      ['/sanction', 'Créer le salon qui regroupe toutes les sanctions (au lieu des logs)'],
      ['/purge', 'Supprimer des messages dans ce salon (par lots)'],
      ['+snipe', 'Réaffiche le dernier message supprimé du salon, avec ses images, pendant 1 h (staff : permission « Gérer les messages »)'],
      ['/lock · /unlock', 'Verrouiller / déverrouiller l’écriture dans ce salon pour le rôle Membre'],
      ['/slowmode', 'Régler le mode lent du salon (0 = off)'],
      ['/nick', 'Changer ou réinitialiser le pseudo d’un membre'],
      ['/lockpseudo · /unlockpseudo', 'Imposer un pseudo à un membre (il ne peut plus se renommer, sauf staff) / le libérer'],
      ['/listepseudo', 'Membres qui n’ont pas le droit de se renommer'],
    ],
  },
  {
    key: 'roles',
    emoji: '🎭',
    name: 'Rôles & grades',
    summary: 'Donner ou retirer des rôles, rank / derank, rôles automatiques',
    about:
      'Gestion des rôles à la main (un modérateur ne peut pas donner un rôle au niveau du sien ou au-dessus), ' +
      'annonces de rank / derank, et rôles donnés automatiquement selon le statut, le tag du serveur ou des incompatibilités.',
    lines: [
      ['/role', 'Ajouter ou retirer un rôle à un membre (bascule)'],
      ['/roletempo', 'Donner un rôle à un membre pour une durée (ex : `15m`), retiré automatiquement à la fin'],
      ['/massrole', '`donner` `retirer` un rôle à plusieurs membres'],
      ['/rank', 'Donner un ou deux rôles à un membre et l’annoncer en embed (« Rank up par @staff »)'],
      ['/derank', 'Retirer jusqu’à 5 rôles à un membre, le prévenir en MP et l’annoncer (« Derank par @staff »)'],
      ['/configrank', 'Choisir le salon et les messages des annonces de /rank et /derank'],
      ['/statut', '`role` — rôle donné aux membres qui ont un mot-clé dans leur statut (activer → mots-clés, un par ligne ; désactiver)'],
      ['/tagrole', '`activer` `desactiver` `voir` — rôle si le tag du serveur est porté'],
      ['/antirole', '`ajouter` `liste` `retirer` — rôles incompatibles (ex : Actif retire Nouveau)'],
    ],
  },
  {
    key: 'arrivals',
    emoji: '🛡️',
    name: 'Arrivées & vérification',
    summary: 'Captcha anti-bot, bienvenue, départs, MP d’arrivée, invitations',
    about:
      'À son arrivée, un membre passe la vérification anti-bot (captcha) si elle est configurée, reçoit le message ' +
      'de bienvenue et, si activé, un MP. Les comptes créés il y a moins de 2 jours sont expulsés automatiquement. ' +
      'Le bot repère aussi quelle invitation chaque nouveau membre a utilisée et la compte à son parrain, ' +
      'en suivant ceux qui sont repartis.',
    lines: [
      ['/configverif', 'Configurer la vérification anti-bot (captcha)'],
      ['/passer-verif', 'Valider manuellement la vérification d’un membre, ou de tous les non-vérifiés avec `tout` (administrateurs)'],
      ['/bienvenue', 'Configurer le message de bienvenue (arrivées)'],
      ['/quitte', 'Configurer le message de départ'],
      ['/dmjoin', 'Message privé envoyé à chaque membre qui rejoint le serveur (vide = désactivé)'],
      ['/bilan', 'Bilan des arrivées et départs sur une période'],
      ['/inviteconfig', '`salon` `desactiver` — salon de suivi des invitations'],
      ['/invitations', 'Suivi des invitations d’un membre (total, détail, palier)'],
      ['/invitrank', '`ajouter` `liste` `retirer` — paliers de rôles selon les invitations'],
    ],
  },
  {
    key: 'tickets',
    emoji: '🎫',
    name: 'Tickets',
    summary: 'Panneau, motifs, staff, avis et fermeture',
    about:
      'Les membres ouvrent un ticket depuis le panneau (menu des motifs). Le staff le prend en charge, peut ajouter un membre, ' +
      'puis le ferme avec une raison : transcription archivée et MP au membre (avec un avis ⭐ si activé). ' +
      'Sans message pendant 3 jours, le bot mentionne le staff et demande s’il faut le fermer.',
    lines: [
      ['/configticket', 'Configurer le système de tickets (assistant guidé)'],
      ['/ajouterroleticket', 'Ajouter un rôle au staff des tickets (accès + mention à l’ouverture)'],
      ['/retirerroleticket', 'Retirer un rôle du staff des tickets'],
      ['/messageticket', 'Premier message envoyé dans un ticket, pour un motif (`[@]` = mention de l’auteur)'],
      ['/modifierembedticket', 'Changer l’embed d’ouverture d’un ticket (GIF, miniature, couleur, titre — pour tous les motifs ou un seul) et le texte de chaque motif'],
      ['/avisticket', '`activer` `desactiver` `voir` — avis (⭐) à la fermeture (ticket 1, 2 ou les deux)'],
    ],
  },
  {
    key: 'levels',
    emoji: '📈',
    name: 'Système de niveaux',
    summary: 'XP par message et en vocal, événements, boosters, récompenses',
    about:
      'Chaque message rapporte de l’XP selon sa longueur (de 3 à 75 XP, au plus une fois toutes les 3 s), et chaque minute ' +
      'en conversation vocale 5 XP (sans sourdine, à 2 au moins, hors AFK). Un événement du staff (×2 ou ×3), un booster ' +
      'acheté dans la boutique et un rôle boosté (ex : VIP) multiplient l’XP. Passer un niveau rapporte 💰 200, s’annonce avec une carte en image et met à ' +
      'jour les rôles-récompenses : en addition (gardés) ou évolutifs (remplacés au palier suivant), dès le niveau 0. ' +
      'Un palier peut aussi donner de l’argent.',
    lines: [
      ['/niveau', 'Voir ton niveau, ton XP, ta progression et tes bonus d’XP en cours (ou ceux d’un membre)'],
      ['/top', 'Classements en onglets : niveaux, argent, coins, poche, teams, réputation, messages, vocal, invitations et quiz'],
      ['/xp', '`ajouter` `retirer` — donner ou retirer des niveaux à un membre ; `definir` — fixer son XP ou son niveau ; `evenement` — XP ×2 ou ×3 pour tout le serveur pendant une durée ; `recompense` — paliers : rôle (addition ou évolutif) et/ou argent (admin)'],
      ['/configniveau', '`activer` `desactiver` `voir` `message` — activer le système et personnaliser l’annonce de passage de niveau (admin)'],
    ],
  },
  {
    key: 'economy',
    emoji: '💰',
    name: 'Économie & boutique',
    summary: 'Argent des niveaux : quêtes, drops, membres de la semaine, rôles boostés, boutique',
    about:
      'L’**argent** 💰 se gagne en étant actif : en écrivant (💰 5 par message, 25 au-delà de 125 caractères), en passant des niveaux (💰 200), ' +
      'avec les drops d’argent à ramasser dans les salons, les quêtes, le quiz, les giveaways et les récompenses des membres de la ' +
      'semaine (top 3 messages et top 3 vocal, chaque lundi). Un rôle boosté (ex : VIP ×1,5) fait gagner plus en étant actif. ' +
      'Il se dépense dans la boutique `/shop` : rôles, rôles temporaires, boosters d’XP, objets personnalisés qui ouvrent un ticket. ' +
      'Les **coins** 🪙 du casino sont une monnaie à part, qui ne sert pas dans `/shop` : catégorie 🎰 Casino.',
    lines: [
      ['/boostrole', '`ajouter` `retirer` `liste` — rôle qui fait gagner plus d’XP et/ou d’argent (ex : VIP ×1,5) (admin)'],
      ['/shop', 'Boutique : acheter des objets avec ton argent et voir ton inventaire — chaque jour, un objet en promo à -10 % ; chaque achat est noté dans #logs-boutique'],
      ['/quetes', '`voir` — quêtes de la semaine et ta progression ; `ajouter` `retirer` (staff) : objectif en messages, minutes de vocal, drops ou dailies, récompense en argent et/ou niveaux'],
      ['/configeconomie', '`drops` (salons, montants, fréquence) · `semaine` (argent du top 1/2/3 messages et vocal, rôle) · `voir` (admin)'],
      ['/money', '`ajouter` `retirer` — donner / retirer de l’argent ou des coins (option `monnaie`) à un membre · `tous` — à tous les membres du serveur (admin)'],
      ['/add-item · /remove-item', 'Ajouter / retirer un objet de la boutique — types : personnalisé (ticket), rôle permanent, rôle temporaire, booster d’XP (admin)'],
      ['/change-item', 'Modifier le nom, le prix ou la description d’un objet (admin)'],
      ['/configshop', 'Titre, description et couleur de la boutique (admin)'],
      ['/history-shop', 'Historique des achats de la boutique, ou ceux d’un membre (admin)'],
    ],
  },
  {
    key: 'casino',
    emoji: '🎰',
    name: 'Casino',
    summary: 'Commandes « . » : banque, livret, work, mine, vols, blackjack, poker, roulette…',
    about:
      'Le casino se joue avec des commandes qui commencent par un **point**, écrites dans le chat (ex : `.balance`). ' +
      '`.help` les liste toutes, `.help <commande>` explique l’une d’elles. On joue avec des **coins** 🪙, une monnaie à part de l’argent ' +
      'des niveaux (les coins ne servent pas dans `/shop`, et l’argent ne sert pas au casino). On mise les coins de sa **poche** (`500`, `2k`, `all`) ; ' +
      'la poche peut se faire voler, la **banque** et le **livret A** sont à l’abri. Classements : `/top coins`, `/top poche`, `/top réputation`.',
    lines: [
      ['.help', 'La liste des commandes du casino, et `.help <commande>` pour les détails'],
      ['.balance · .dep · .with · .livret', 'Poche, banque et livret A d’un membre · déposer (on garde 💰 200 en poche) · retirer · livret A (1 % d’intérêts par jour, plafond 25 000, historique)'],
      ['.shop · .buy', 'Boutique du casino : bâtiments qui rapportent toutes les 2 h (Bar 2 000 → +100 … Mairie 8 000 → +600), anti-rob (3 h, 💰 3 000), wagon (💰 1 500, débloque `.mine` et `.wagon`)'],
      ['.daily · .work · .slut · .gift · .roue', 'Daily (100, +10 par jour de série jusqu’à 200) · petit boulot (1 h) · soirée à risque (1 h) · trois cartes, une seule cache le gros lot (2 h) · roue de la fortune (une fois par jour : coins, XP, booster… ou rien)'],
      ['.mine · .wagon', 'Avec un wagon : miner des minerais (1 h), qui vont dans le wagon · voir le wagon et tout revendre'],
      ['.rob · .antivol', 'Voler la poche d’un membre (45 %, amende sinon, 1 h) · acheter l’anti-rob de la boutique (3 h de protection)'],
      ['.pay · .trade · .rep', 'Donner des coins · acheter un objet à un membre (il accepte avec un bouton, noté dans les logs) · +1 de réputation à un membre ou une team (1 par jour)'],
      ['.team', '`creer` (🪙 500) `inviter` `quitter` `expulser` `dissoudre` `info` · `deposer` `retirer` (coffre commun) · `acheter soldats|cadenas` · `attaquer <nom>` (piller le coffre d’une autre team, toutes les 2 h ; chaque cadenas bloque une attaque)'],
      ['.activity', 'Lance Poker Night, l’activité casino de Discord, dans ton salon vocal'],
      ['.bj · .poker · .roulette · .slots · .pf', 'Blackjack et poker (avec images des cartes), roulette, machine à sous, pile ou face — bouton 🔁 Rejouer'],
      ['/duel', 'Morpion, puissance 4 ou pierre-feuille-ciseaux contre un membre, avec une mise en coins : le gagnant remporte tout'],
    ],
  },
  {
    key: 'fun',
    emoji: '🎮',
    name: 'Mini-jeux & fun',
    summary: 'Duels, tu préfères, drapeaux, quiz, comptage, love calc, citations, GIF',
    about: 'De quoi animer le serveur : duels entre membres, jeux dans un salon, votes, pourcentages d’amour et citations en image.',
    lines: [
      ['/duel', 'Défier un membre au morpion, au puissance 4 ou à pierre-feuille-ciseaux (2 manches gagnantes), avec une mise facultative : le gagnant remporte tout'],
      ['/tu-preferes', 'Dilemme « Tu préfères… » pour une durée (ex : `15m`) : options A/B au hasard ou choisies, vote, pourcentages à la fin'],
      ['/guessflag', '`activer` `desactiver` — jeu « Devine le drapeau » dans un salon (indices, passer, classement ; mauvaises réponses marquées ❌ puis supprimées après 2 s, toutes notées dans #logs-drapeau)'],
      ['/quiz', '`activer` `desactiver` `question` — quiz dans un salon (culture générale, jeux vidéo et animés, 30 min pour répondre) : le premier qui trouve gagne de l’argent (classement dans `/top`) ; un rôle peut être mentionné à chaque question · `question-du-jour` (`activer` `desactiver` `envoyer`) — une question ouverte chaque jour à l’heure choisie, avec un rôle mentionné et un fil pour les réponses'],
      ['^^lc ^^hc ^^fc', 'Pourcentage d’amour (`^^lc`), de haine (`^^hc`) ou d’amitié (`^^fc`) : `random`, `@membre` ou `@membre1 @membre2`'],
      ['@Kayoshi (en réponse)', 'Réponds à un message en mentionnant le bot : citation en image (boutons : thème clair, couleur, gras, serif, supprimer)'],
      ['kayo hug · kiss · slap', 'Écrire `kayo hug @membre` (ou `kiss`, `slap`) : câlin, bisou ou gifle avec un GIF d’anime (`hana` marche aussi)'],
      ['/gif', 'Transformer une image (fichier ou lien) en GIF, pour l’ajouter à tes GIF favoris'],
      ['kayo pp · kayo banner', 'Photo de profil ou bannière d’un membre (ou la tienne) ; `server` pour celles du serveur (`hana` marche aussi)'],
      ['/coiffeur', 'Répondre « feur » quand un message finit par « quoi »'],
      ['/compteur', 'Panneau avec les boutons Activer (choix du salon), Désactiver et Voir — salon de comptage : 1, 2, 3… à tour de rôle, sans fin (une erreur est refusée, le compteur ne recommence jamais)'],
    ],
  },
  {
    key: 'family',
    emoji: '💍',
    name: 'Famille',
    summary: 'Mariages, adoptions, arbre généalogique',
    about:
      'Mariages (plusieurs possibles) et adoptions virtuels, avec l’accord de l’autre membre. L’arbre de /family montre conjoints, ' +
      'parent et enfants, y compris ceux des conjoints. La famille est commune à Hanami et à l’ancien serveur.',
    lines: [
      ['/marry · /divorce', 'Demander un membre en mariage (il doit accepter) / annuler un de ses mariages'],
      ['/adopt · /family', 'Adopter un membre (il doit accepter) / voir son arbre généalogique en image'],
      ['/renier · /fuguer', 'Renier un de ses enfants adoptés / fuguer : quitter son parent adoptif'],
    ],
  },
  {
    key: 'communication',
    emoji: '📢',
    name: 'Annonces, embeds & giveaways',
    summary: 'Annonces, embeds, role-react, giveaways, /say',
    about: 'Pour publier au nom du bot : annonces, embeds personnalisés (avec boutons de rôles), giveaways et messages sauvegardés.',
    lines: [
      ['/announce', 'Publier une annonce dans un salon précis'],
      ['/embed', 'Créer un embed (aperçu modifiable) : envoi, role-react (boutons ou sélecteur de rôle), partenariat, ou bienvenue / départ'],
      ['/modifierembed', 'Modifier ou renvoyer (📨) un embed existant (embeds de /embed, partenariat, bienvenue / départ, panneau de tickets et ses motifs, qu’on peut réorganiser)'],
      ['/gw', '`start` `end` `reroll` `retirer-participant` — giveaways : argent (crédité automatiquement aux gagnants) ou prix personnalisé (ex : Nitro)'],
      ['/say', 'Faire parler le bot (les membres mentionnés sont notifiés)'],
      ['/save', '`emplacement` (save1 à save5, avec aperçu) · `action` : enregistrer un message ou envoyer celui enregistré'],
      ['/profilbot', '`modifier` `reinitialiser` — photo, bannière et bio du bot sur ce serveur uniquement'],
    ],
  },
  {
    key: 'systems',
    emoji: '⚙️',
    name: 'Salons & systèmes',
    summary: 'Logs, anti-liens, anti-spam, anti-nuke, vocaux, confessions, bump, stats, sauvegardes',
    about: 'Les systèmes automatiques du serveur : logs, protections, salons vocaux temporaires, confessions anonymes et rappel de bump.',
    lines: [
      ['/log', 'Salon des logs du serveur (les logs vocaux vont dans #voc-logs, créé automatiquement à côté)'],
      ['/configlien', 'Blocage des liens (par salon et par rôle) — 2 liens interdits en 1 min = mute 3 h'],
      ['/antispam', '`activer` `desactiver` `voir` — anti-spam (+ mute 1 h si spam multi-salons)'],
      ['/messimage', 'Message envoyé quand un membre poste un GIF sans la perm image (+ 4 rôles ignorés)'],
      ['/one-message', '`activer` `desactiver` `liste` — messages supprimés automatiquement'],
      ['/configvocal', 'Salons vocaux temporaires (Join to Create)'],
      ['/join', 'Faire rejoindre un salon vocal au bot (il y reste, même vide)'],
      ['/configstat', 'Salon du classement des membres les plus actifs de la semaine (nouveau message chaque semaine, l’ancien est supprimé)'],
      ['/configboost', 'Message quand quelqu’un boost le serveur (envoyé 10 s après, re-boosts compris)'],
      ['/configconfessions', 'Confessions anonymes (texte et/ou image, réponses dans un fil, MP à l’auteur) + salon de logs pour le staff'],
      ['/bremind', 'Activer / désactiver le rappel de bump Disboard (2 h après chaque /bump)'],
      ['/bremind-edit', 'Message de rappel, rôle à mentionner, message après avoir bump'],
      ['/reset', 'Supprimer un salon et le recréer à l’identique'],
      ['/salon-stats', 'Panneau : salons vocaux verrouillés en haut du serveur dont le nom affiche un chiffre à jour (membres, en ligne, en vocal, boosts), toutes les 10 min'],
      ['/backup', '`creer` `liste` `telecharger` `restaurer` — sauvegarde des rôles, salons et permissions (automatique chaque jour) ; la restauration recrée seulement ce qui manque, rien n’est supprimé (admin)'],
      ['/antinuke', '`voir` `activer` `desactiver` `ajouter` `retirer` — suppressions de salons / rôles, bans ou expulsions en masse (en moins d’une minute) : rôles retirés, propriétaire prévenu ; membres de confiance jamais visés (réglages : propriétaire du serveur)'],
    ],
  },
  {
    key: 'utils',
    emoji: '🧰',
    name: 'Infos & utilitaires',
    summary: 'Stats en image, infos membre / serveur, emojis',
    about: 'Statistiques d’activité, fiches d’infos et outils pratiques.',
    lines: [
      ['s?u s?t s?m s?v', 'Stats en image (14 derniers jours) : `s?u` les tiennes ou celles d’un membre, `s?t` le top, `s?m` les messages, `s?v` le vocal'],
      ['+vc', 'Statistiques du serveur : membres, en ligne, en vocal, actifs (en vocal, ni mute ni en sourdine), en stream et mute'],
      ['/serverinfo', 'Statistiques du serveur'],
      ['/userinfo', 'Fiche d’un membre'],
      ['/pseudo', 'Envoyer le pseudo d’un membre'],
      ['/copyemoji', 'Copier des emojis d’un autre serveur sur celui-ci'],
      ['/emoji', '`rename` `delete` `image` — renommer, supprimer un emoji du serveur, ou envoyer son image'],
      ['/ping', 'Latence du bot'],
      ['/help', 'Ce menu'],
    ],
  },
];

// Les 15 dernières commandes ajoutées, la plus récente en premier (page d'accueil).
// À mettre à jour à chaque nouvelle commande : l'ajouter en tête et retirer la dernière.
const RECENT = [
  ['/antinuke', 'protection contre les nukes'],
  ['.team', 'teams : coffre, soldats, cadenas, attaques'],
  ['.shop', 'bâtiments, anti-rob et wagon'],
  ['.help', 'le casino en commandes « . »'],
  ['.livret', 'livret A avec intérêts chaque jour'],
  ['.trade', 'acheter un objet à un membre'],
  ['+snipe', 'dernier message supprimé (staff)'],
  ['/backup', 'sauvegarder et restaurer le serveur'],
  ['/salon-stats', 'salons qui affichent les stats du serveur'],
  ['/duel', 'morpion, puissance 4, pierre-feuille-ciseaux'],
  ['/top', 'tous les classements en onglets'],
  ['/quiz', 'quiz de culture générale'],
  ['/boostrole', 'rôles qui gagnent plus d’XP et d’argent'],
  ['/statut', 'rôle selon un mot-clé du statut'],
  ['/compteur', 'salon de comptage, sans fin'],
];

// Les 10 dernières commandes modifiées, la plus récente en premier (page d'accueil).
// À mettre à jour à chaque changement d'une commande existante : l'ajouter (ou la remonter) en tête.
const RECENT_CHANGES = [
  ['/modifierembed', 'panneau de tickets : bouton pour réorganiser les motifs'],
  ['+vc', 'nouvel embed : membres, en ligne, en vocal, actifs, en stream, mute'],
  ['/top', 'onglets Coins, Poche et Réputation : argent des niveaux et coins du casino séparés'],
  ['/money', '`tous` : donner à tous les membres ; option `monnaie` : argent ou coins'],
  ['/quiz', 'questions de jeux vidéo et d’animés, 30 min pour répondre ; `question-du-jour` avec fil pour les réponses'],
  ['/compteur', 'panneau à boutons ; une erreur ne remet plus à 1 (message refusé puis effacé)'],
  ['/shop', 'achats notés dans #logs-boutique (créé automatiquement) ; promo du jour à -10 %'],
  ['/xp', '`ajouter` et `retirer` donnent ou retirent directement des niveaux'],
  ['/configboost', 'attend 10 s (plusieurs boosts = un message), les re-boosts aussi, variable `[boosts]`'],
  ['/configstat', 'un nouveau classement chaque semaine, l’ancien est supprimé'],
];

const HOME = 'home';
export const HELP_MENU_ID = 'help_menu';

function homeEmbed() {
  return new EmbedBuilder()
    .setColor(Colors.role)
    .setTitle('📖 Aide de Kayoshi')
    .setDescription(
      'Choisis une catégorie dans le menu ci-dessous pour voir son fonctionnement et toutes ses commandes.\n\n' +
        CATEGORIES.map((c) => `${c.emoji} **${c.name}** — ${c.summary}`).join('\n'),
    )
    .addFields(
      { name: '🆕 Dernières commandes ajoutées', value: RECENT.map(([name, desc]) => `**${name}** — ${desc}`).join('\n') },
      { name: '🔧 Dernières commandes modifiées', value: RECENT_CHANGES.map(([name, desc]) => `**${name}** — ${desc}`).join('\n') },
    )
    .setFooter({ text: 'Astuce : tape « / » dans le champ de message pour voir les options de chaque commande.' });
}

// Pour les tests : commandes de la liste des nouveautés.
export const recentEntries = () => [...RECENT, ...RECENT_CHANGES].map(([name]) => name);

function categoryEmbed(cat) {
  const commands = cat.lines.map(([name, desc]) => `**${name}** — ${desc}`).join('\n');
  return new EmbedBuilder()
    .setColor(Colors.role)
    .setTitle(`${cat.emoji} ${cat.name}`)
    .setDescription(`${cat.about}\n\n${commands}`)
    .setFooter({ text: `${cat.lines.length} entrée(s) · change de catégorie avec le menu ci-dessous` });
}

function menu(selected) {
  const select = new StringSelectMenuBuilder().setCustomId(HELP_MENU_ID).setPlaceholder('📂 Choisis une catégorie…');
  select.addOptions(
    new StringSelectMenuOptionBuilder().setLabel('Accueil').setValue(HOME).setEmoji('🏠').setDescription('Vue d’ensemble des catégories').setDefault(selected === HOME),
    ...CATEGORIES.map((c) =>
      new StringSelectMenuOptionBuilder().setLabel(c.name).setValue(c.key).setEmoji(c.emoji).setDescription(c.summary).setDefault(selected === c.key),
    ),
  );
  return new ActionRowBuilder().addComponents(select);
}

// Contenu du message d'aide pour une catégorie (ou l'accueil).
export function helpMessage(key = HOME) {
  const cat = CATEGORIES.find((c) => c.key === key);
  return { embeds: [cat ? categoryEmbed(cat) : homeEmbed()], components: [menu(cat ? cat.key : HOME)] };
}

// Choix dans le menu : le message d'aide (éphémère) est remplacé par la catégorie choisie.
export async function handleHelpInteraction(interaction) {
  await interaction.update(helpMessage(interaction.values[0]));
}

// Pour les tests : noms de toutes les entrées.
export const helpEntries = () => CATEGORIES.flatMap((c) => c.lines.map(([name]) => name));
