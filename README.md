# Kayoshi-bot

Bot Discord construit avec [discord.js](https://discord.js.org) v14 (Node.js).

## Structure

```
Kayoshi-bot/
├── src/
│   ├── index.js            # Point d'entrée : connecte le bot, gère les interactions
│   ├── deploy-commands.js  # Enregistre les slash commands auprès de Discord
│   └── commands/           # 1 fichier = 1 slash command
│       └── ping.js
├── .env                    # Tes secrets (à créer depuis .env.example — jamais commité)
├── .env.example
└── package.json
```

## Installation

```bash
npm install
```

## Configuration (.env)

Copie `.env.example` en `.env` et remplis :

- `DISCORD_TOKEN` — token du bot
- `CLIENT_ID` — Application ID
- `GUILD_ID` — ID de ton serveur de test (déploiement instantané des commandes)

## Lancer

```bash
npm run deploy   # à faire une fois, puis à chaque ajout/modif de commande
npm start        # démarre le bot
npm run dev      # démarre avec rechargement auto (node --watch)
```

## Ajouter une commande

Crée un fichier dans `src/commands/`, ex. `hello.js` :

```js
import { SlashCommandBuilder } from 'discord.js';

export default {
  data: new SlashCommandBuilder().setName('hello').setDescription('Dit bonjour'),
  async execute(interaction) {
    await interaction.reply(`Salut ${interaction.user.username} !`);
  },
};
```

Puis `npm run deploy` et relance le bot.
