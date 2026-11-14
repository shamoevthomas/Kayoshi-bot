import { PermissionFlagsBits, PermissionsBitField } from 'discord.js';
import configniveau from '../config/configniveau.js';
import configeconomie from '../config/configeconomie.js';
import inviteconfig from '../config/inviteconfig.js';
import antispam from '../config/antispam.js';
import antinuke from '../config/antinuke.js';
import avisticket from '../config/avisticket.js';
import securite from '../config/securite.js';
import configconfessions from '../config/configconfessions.js';
import configlien from '../config/configlien.js';
import configboost from '../config/configboost.js';
import configrank from '../config/configrank.js';
import configshop from '../config/configshop.js';
import configstat from '../config/configstat.js';
import configticket from '../config/configticket.js';
import configvocal from '../config/configvocal.js';
import log from '../config/log.js';
import messimage from '../config/messimage.js';
import coiffeur from '../config/coiffeur.js';
import compteur from '../config/compteur.js';
import salonStats from '../config/salon-stats.js';
import sanction from '../config/sanction.js';
import bienvenue from '../config/bienvenue.js';
import quitte from '../config/quitte.js';
import dmjoin from '../config/dmjoin.js';
import configverif from '../config/configverif.js';
import bremind from '../config/bremind.js';
import bremindEdit from '../config/bremind-edit.js';

// /config : toutes les commandes de configuration en une seule (Discord limite un serveur à 100 commandes).
// Chaque ancienne commande (dossier commands/config) devient une entrée : un groupe si elle a des sous-commandes
// (/config niveau activer), sinon une sous-commande (/config lien) ; « accueil » et « bump » regroupent plusieurs
// petites commandes. Son code (execute) est appelé tel quel, et sa permission d'origine est vérifiée ici.
const ENTRIES = {
  niveau: configniveau,
  economie: configeconomie,
  invitations: inviteconfig,
  antispam,
  antinuke,
  'avis-ticket': avisticket,
  securite,
  confessions: configconfessions,
  lien: configlien,
  boost: configboost,
  rank: configrank,
  boutique: configshop,
  classement: configstat,
  ticket: configticket,
  vocal: configvocal,
  logs: log,
  messimage,
  coiffeur,
  compteur,
  'salon-stats': salonStats,
  sanctions: sanction,
  accueil: {
    description: 'Arrivées : message de bienvenue, de départ, MP d’arrivée et vérification anti-bot',
    modules: { bienvenue, depart: quitte, mp: dmjoin, verif: configverif },
  },
  bump: {
    description: 'Rappel de bump Disboard et son message',
    modules: { rappel: bremind, message: bremindEdit },
  },
};

const SUB_COMMAND = 1;
const SUB_COMMAND_GROUP = 2;

// Une commande devenue sous-commande : ses options ; devenue groupe : ses sous-commandes.
function entryJson(name, entry) {
  if (entry.modules) {
    return {
      type: SUB_COMMAND_GROUP,
      name,
      description: entry.description,
      options: Object.entries(entry.modules).map(([sub, mod]) => {
        const json = mod.data.toJSON();
        return { type: SUB_COMMAND, name: sub, description: json.description, options: json.options ?? [] };
      }),
    };
  }
  const json = entry.data.toJSON();
  const subs = (json.options ?? []).filter((o) => o.type === SUB_COMMAND);
  return subs.length
    ? { type: SUB_COMMAND_GROUP, name, description: json.description, options: subs }
    : { type: SUB_COMMAND, name, description: json.description, options: json.options ?? [] };
}

const json = {
  name: 'config',
  description: 'Configurer le bot : niveaux, confessions, liens, sécurité, tickets, arrivées…',
  default_member_permissions: String(PermissionFlagsBits.ManageGuild),
  contexts: [0], // serveurs uniquement
  options: Object.entries(ENTRIES).map(([name, entry]) => entryJson(name, entry)),
};

// Commande d'origine visée par l'interaction (/config <entrée> [<sous-commande>]).
function target(interaction) {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(false);
  const entry = ENTRIES[group ?? sub];
  return entry?.modules ? entry.modules[sub] : entry;
}

export default {
  data: { name: 'config', toJSON: () => json },

  async execute(interaction) {
    const mod = target(interaction);
    if (!mod) return interaction.reply({ content: '❌ Réglage inconnu.', ephemeral: true });
    const needed = mod.data.toJSON().default_member_permissions;
    if (needed && !interaction.memberPermissions?.has(BigInt(needed))) {
      const names = new PermissionsBitField(BigInt(needed)).toArray().join(', ');
      return interaction.reply({ content: `❌ Il te faut la permission **${names}** pour ce réglage.`, ephemeral: true });
    }
    return mod.execute(interaction);
  },

  async autocomplete(interaction) {
    return target(interaction)?.autocomplete?.(interaction);
  },
};
