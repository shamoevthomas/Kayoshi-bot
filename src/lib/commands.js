import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Charge récursivement toutes les commandes (fichiers .js) d'un dossier et ses sous-dossiers.
export async function loadCommands(dir) {
  const commands = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      commands.push(...(await loadCommands(full)));
    } else if (entry.endsWith('.js')) {
      const mod = (await import(pathToFileURL(full).href)).default;
      if (mod?.data && mod?.execute) commands.push(mod);
      else console.warn(`[warn] La commande ${entry} n'a pas de "data" ou "execute".`);
    }
  }
  return commands;
}
