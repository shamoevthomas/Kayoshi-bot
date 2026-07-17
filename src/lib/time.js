// Parse une durée type "10m", "1h", "7d", "2w", "perm".
// Renvoie { permanent, ms } ou null si le format est invalide.
export function parseDuration(str) {
  const s = (str || '').trim().toLowerCase();
  if (!s || ['perm', 'permanent', 'p', '0', '∞'].includes(s)) return { permanent: true, ms: null };
  const m = s.match(/^(\d+)\s*(s|min|m|h|d|j|w)$/);
  if (!m) return null;
  const mult = { s: 1000, m: 60_000, min: 60_000, h: 3_600_000, d: 86_400_000, j: 86_400_000, w: 604_800_000 };
  return { permanent: false, ms: Number(m[1]) * mult[m[2]] };
}

// Formate une durée en ms de façon lisible ("2 j 3 h").
export function formatDuration(ms) {
  if (ms == null) return 'permanent';
  const units = [
    ['j', 86_400_000],
    ['h', 3_600_000],
    ['min', 60_000],
    ['s', 1000],
  ];
  const parts = [];
  let rest = ms;
  for (const [label, size] of units) {
    const n = Math.floor(rest / size);
    if (n > 0) {
      parts.push(`${n} ${label}`);
      rest -= n * size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ') || '0 s';
}
