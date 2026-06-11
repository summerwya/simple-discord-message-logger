# simple-message-logger

Simple usage:

```
git clone https://github.com/summerwya/simple-discord-message-logger.git
cd simple-discord-message-logger
notepad .\config.json
notepad .\env
docker compose up --build -d
```

## config.json example

```json
{
    "logChannel": "discordChannelId",
    "resendUnsent": true
}
```

## .env file example

```
DISCORD_TOKEN=discord_token
```

<hr />

Made with [discord.js](https://discord.js.org/)