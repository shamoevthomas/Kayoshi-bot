import { getShopItems, addShopItem } from './store.js';

// Migration one-shot : copie la boutique de l'ancien serveur vers le nouveau.
// - Ne fait rien si la boutique du nouveau serveur contient déjà des objets.
// - Repointe les objets « personnalisé » vers le motif m3 (Boutique) et les
//   objets « rôle » vers le rôle VIP du nouveau serveur.
// Passe par le cache du store (addShopItem) pour rester cohérent avec le bot en vol.
const OLD = '1201199956707516476';
const NEW = '1563159382361907350';
const NEW_MOTIF = 'm3';
const NEW_VIP_ROLE = '1563160561477353493';

export function migrateShopOldToNew() {
  if (Object.keys(getShopItems(NEW)).length > 0) return; // déjà fait
  const oldItems = Object.values(getShopItems(OLD));
  if (!oldItems.length) return;
  for (const it of oldItems) {
    const copy = { ...it };
    delete copy.createdAt; // regénéré par addShopItem
    if (copy.motifId) copy.motifId = NEW_MOTIF;
    if (copy.roleId) copy.roleId = NEW_VIP_ROLE;
    addShopItem(NEW, copy);
  }
  console.log(`🛒 Boutique migrée vers le nouveau serveur : ${Object.keys(getShopItems(NEW)).length} objet(s).`);
}
