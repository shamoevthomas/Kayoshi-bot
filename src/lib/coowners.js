// Co-propriétaires : sur les serveurs de laysox_off, 50.nn (ex-crown2ito) et l0un4tik ont les mêmes droits que le
// propriétaire dans le bot (réglages réservés au propriétaire comme l'anti-nuke, hiérarchie des rôles, protections).
// Le DM de masse (@Kayoshi cmd) garde ses propres règles d'utilisation (lib/massdm.js) ; ils y donnent ou retirent l'accès.
const DELEGATING_OWNER_ID = '1079335251551191061'; // laysox_off
export const CO_OWNERS = ['1543615549974515763', '1260266494839754866']; // 50.nn, l0un4tik

export const isCoOwner = (guild, userId) => guild?.ownerId === DELEGATING_OWNER_ID && CO_OWNERS.includes(userId);
export const isOwnerLike = (guild, userId) => userId === guild?.ownerId || isCoOwner(guild, userId);
