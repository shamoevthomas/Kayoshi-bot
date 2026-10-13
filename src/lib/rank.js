// Annonce de rank (/rank) : message configuré avec /configrank, posté en embed.

export const RANK_TEMPLATE_HELP =
  'Templates : `[@]` (le membre) · `[role]` (le ou les rôles donnés) · `[motif]` (le motif) · `[staff]` (celui qui a fait le /rank)';

export const DEFAULT_RANK_MESSAGE = '[@] a été rank [role]\nmotif : [motif]';

export function renderRankMessage(template, { member, roles, motif, staff }) {
  return template
    .replace(/\[@\]/g, `${member}`)
    .replace(/\[r[oô]le( gagn[ée])?\]/gi, roles.map((r) => `${r}`).join(' et '))
    .replace(/\[motif\]/gi, motif || 'Non précisé')
    .replace(/\[staff\]/gi, `${staff}`);
}
