// Annonces de /rank et /derank : messages configurés avec /configrank, postés en embed.

export const RANK_TEMPLATE_HELP =
  'Templates : `[@]` (le membre) · `[role]` (le ou les rôles donnés / retirés) · `[motif]` (le motif) · `[staff]` (celui qui a fait le /rank ou le /derank)';

export const DEFAULT_RANK_MESSAGE = '[@] a été rank [role]\nmotif : [motif]';
export const DEFAULT_DERANK_MESSAGE = '[@] a été derank [role]\nmotif : [motif]';

// « @a », « @a et @b », « @a, @b et @c ».
export function listRoles(roles) {
  const names = roles.map((r) => `${r}`);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} et ${names.at(-1)}` : names.join('');
}

export function renderRankMessage(template, { member, roles, motif, staff }) {
  return template
    .replace(/\[@\]/g, `${member}`)
    .replace(/\[r[oô]le( gagn[ée])?\]/gi, listRoles(roles))
    .replace(/\[motif\]/gi, motif || 'Non précisé')
    .replace(/\[staff\]/gi, `${staff}`);
}

// Annonce postée dans le salon de /configrank : le message configuré, puis
// « Rank up par @staff » ou « Derank par @staff ».
export function renderRankAnnouncement(template, data, action) {
  return `${renderRankMessage(template, data).slice(0, 3900)}\n\n${action} par ${data.staff}`;
}
