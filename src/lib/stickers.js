// Autocollants (Hanami) : chaque nom finit par « ␣␣/hanamifr » (deux espaces avant l'invitation). Appliqué à chaque
// nouvel autocollant (stickerCreate) et au démarrage pour ceux qui ne l'ont pas. Une fin d'invitation mal écrite
// (« /hanmifr », « .gg/hanamifr », espace en trop…) est remplacée ; un nom trop long est coupé au dernier mot entier,
// Discord limitant le nom d'un autocollant à 30 caractères.
const INVITES = { '1563159382361907350': '/hanamifr' };
const MAX_NAME = 30;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Nom avec l'invitation à la fin (ou le même nom s'il est déjà bon).
export function nameWithInvite(name, invite) {
  const suffix = `  ${invite}`;
  if (name.endsWith(suffix)) return name;
  // Retire une invitation déjà là mais mal écrite, puis les espaces de la fin.
  let base = name.replace(/\s*(?:\.gg\/|\/)h[a-z]*fr\s*$/i, '').trimEnd();
  const room = MAX_NAME - suffix.length;
  if (base.length > room) {
    const cut = base.slice(0, room);
    const space = cut.lastIndexOf(' ');
    base = (space > room / 2 ? cut.slice(0, space) : cut).trimEnd();
  }
  return `${base || 'sticker'}${suffix}`;
}

// Renomme l'autocollant si besoin. Renvoie true s'il a été renommé.
export async function fixSticker(sticker) {
  const invite = INVITES[sticker.guildId ?? sticker.guild?.id];
  if (!invite) return false;
  const name = nameWithInvite(sticker.name, invite);
  if (name === sticker.name) return false;
  return sticker
    .edit({ name, reason: `Invitation ${invite} ajoutée au nom de l’autocollant` })
    .then(() => true)
    .catch((err) => (console.error('[autocollants]', sticker.name, err.message), false));
}

// Au démarrage : tous les autocollants des serveurs concernés (un renommage par seconde au plus).
export async function sweepStickers(client) {
  for (const guildId of Object.keys(INVITES)) {
    const guild = client.guilds.cache.get(guildId);
    const stickers = await guild?.stickers.fetch().catch(() => null);
    for (const sticker of stickers?.values() ?? []) if (await fixSticker(sticker)) await sleep(1000);
  }
}
