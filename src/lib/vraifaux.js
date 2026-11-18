// Discord affiche « True / False » pour une option booléenne, même en français : on utilise à la place une option
// texte à deux choix, « Vrai » / « Faux ». vraiFaux(o) ajoute les choix ; getVraiFaux(options, nom) → true, false ou
// null (option non remplie).
export const vraiFaux = (o) => o.addChoices({ name: 'Vrai', value: 'true' }, { name: 'Faux', value: 'false' });

export function getVraiFaux(options, name) {
  const value = options.getString(name);
  return value === null || value === undefined ? null : value === 'true';
}
