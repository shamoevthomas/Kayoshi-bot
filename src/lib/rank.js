// Annonces de /rank et /derank : messages configurés avec /configrank, postés en embed.

export const RANK_TEMPLATE_HELP =
  'Templates : `[@]` (le membre) · `[role]` (le ou les rôles donnés / le rôle retiré) · `[motif]` (le motif) · `[staff]` (celui qui a fait le /rank ou le /derank)';

export const DEFAULT_RANK_MESSAGE = '[@] a été rank [role]\nmotif : [motif]';
export const DEFAULT_DERANK_MESSAGE = '[@] a été derank [role]\nmotif : [motif]';

export function renderRankMessage(template, { member, roles, motif, staff }) {
  return template
    .replace(/\[@\]/g, `${member}`)
    .replace(/\[r[oô]le( gagn[ée])?\]/gi, roles.map((r) => `${r}`).join(' et '))
    .replace(/\[motif\]/gi, motif || 'Non précisé')
    .replace(/\[staff\]/gi, `${staff}`);
}
