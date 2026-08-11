// Semaine du lundi au dimanche, calculée sur le fuseau Europe/Paris.
const TZ = 'Europe/Paris';

// Renvoie la date (YYYY-MM-DD) telle qu'affichée à Paris.
function parisYMD(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

// Date (midi UTC) du lundi de la semaine contenant `date` à Paris.
export function getMonday(date = new Date()) {
  const d = new Date(`${parisYMD(date)}T12:00:00Z`);
  const day = d.getUTCDay(); // 0 = dimanche … 6 = samedi
  const diff = day === 0 ? 6 : day - 1; // recule jusqu'au lundi
  d.setUTCDate(d.getUTCDate() - diff);
  return d;
}

// Clé stable de la semaine (date du lundi), utilisée pour réinitialiser les compteurs.
export function getWeekKey(date = new Date()) {
  return getMonday(date).toISOString().slice(0, 10);
}

// Libellé « du 11 août au 17 août » pour l'affichage.
export function getWeekRange(date = new Date()) {
  const mon = getMonday(date);
  const sun = new Date(mon);
  sun.setUTCDate(sun.getUTCDate() + 6);
  const fmt = (d) => new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, day: 'numeric', month: 'long' }).format(d);
  return { start: fmt(mon), end: fmt(sun) };
}
