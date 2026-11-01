import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { createClient } from '@supabase/supabase-js';
import { NOTIFY, HOME } from './lib/uptime.js';

// Lancé par l'instance de secours (SECOURS=1, src/index.js) au moment où elle s'arrête : attend que le bot de Render
// note qu'il est en ligne (toutes les 5 min, lib/uptime.js), puis l'annonce en MP. Rien au bout de 30 min : alerte.
const since = Number(process.argv[2]) || Date.now();
const rest = new REST().setToken(process.env.DISCORD_TOKEN);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY, { auth: { persistSession: false } });

async function dm(content) {
  for (const id of NOTIFY) {
    const channel = await rest.post(Routes.userChannels(), { body: { recipient_id: id } }).catch(() => null);
    if (channel) await rest.post(Routes.channelMessages(channel.id), { body: { content } }).catch(() => {});
  }
}

while (Date.now() < since + 30 * 60_000) {
  await new Promise((resolve) => setTimeout(resolve, 30_000));
  const { data } = await supabase.from('kayoshi_store').select('data').eq('guild_id', HOME).maybeSingle();
  if ((data?.data?.botStatus?.lastAlive ?? 0) > since) {
    await dm('✅ **Kayøshi est de retour sur Render !** Le relais est terminé, tout tourne de nouveau sur Render.');
    process.exit(0);
  }
}
await dm('⚠️ Kayøshi devait repasser sur Render, mais Render n’a donné aucun signe de vie en 30 min : le bot est peut-être hors ligne.');
process.exit(0);
