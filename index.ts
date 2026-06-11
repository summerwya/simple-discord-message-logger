import { AttachmentBuilder, Client, Colors, EmbedBuilder, Events, ForumChannel, GatewayIntentBits, Guild, GuildMember, Message, User, type OmitPartialGroupDMChannel, type PartialMessage } from 'discord.js';
import { DataTypes, Model, Sequelize } from 'sequelize';
import type { Shared, Attachment } from './types';
import { join } from 'path';
import { createWriteStream, readFileSync, unlinkSync, writeFileSync } from 'fs';
import botConfig from './config.json';
import sanitize from 'sanitize-filename';
import pino from 'pino';

const dataFolder = join(__dirname, "data/");

const prettyStream = pino.transport({
  target: 'pino-pretty',
  options: {
    colorize: true,
  }
});

const logger = pino({
    level: 'trace'
    },
    pino.multistream([
        { stream: prettyStream, level: 'trace' },
        { stream: createWriteStream(join(__dirname, 'logs', 'bot.log'), { flags: 'a' }), level: 'info' }
    ])
);

// SECTION - Database
const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: join(dataFolder, 'db.sqlite')
});

class LoggedMessage extends Model {
    declare id: bigint;
    declare guildId: string;
    declare channelId: string;
    declare authorId: string;
    declare content: string;
    declare attachments: string;
    declare createdAt: any;
}

LoggedMessage.init({
    id: {
        type: DataTypes.BIGINT,
        primaryKey: true
    },
    guildId: DataTypes.STRING,
    channelId: DataTypes.STRING,
    authorId: DataTypes.STRING,
    content: {
        type: DataTypes.STRING,
        allowNull: true,
    },
    attachments: {
        type: DataTypes.STRING,
        defaultValue: '[]'
    }
}, { sequelize, modelName: "LoggedMessage" });
//!SECTION

// SECTION - Discord Client
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMessages] });

let shared: Shared = {
    logChannel: null
};

client.once(Events.ClientReady, async readyClient => {
    const log = logger.child({ event: "Client Ready"});
    log.info("Logged into discord");
    
    if (botConfig.logChannel) {
        shared.logChannel = await readyClient.channels.fetch(botConfig.logChannel);
        if (!shared.logChannel?.isSendable()) throw new TypeError("Invalid log channel provided!");
    } else log.trace("No logChannel provided");

	log.info(`Message Logger Started! Logged in as ${readyClient.user.tag}`);
});

client.on(Events.MessageCreate, async message => {
    const log = logger.child({ event: "MessageCreate" });
    if (!message.guildId) return log.trace("Message has no guildId");

    const [loggedMessage, created] = await LoggedMessage.findOrCreate({
        where: {
            id: message.id,
            guildId: message.guildId,
            channelId: message.channelId,
            authorId: message.author.id,
            content: message.content,
        }
    });

    if (!created) return;

    log.trace(`Trying to log message ${message.id}`);

    const attachments: Attachment[] = [];
    for(let file of message.attachments.values()) {
        // 12mb file limit
        if (file.size >= 12000000) {
            log.warn(`Couldn't log attachment, file size limit reached (${file.size})`);
            continue;
        } else {
            try {
                const filePath: string = join(dataFolder, '.cached_attachments', sanitize(`${file.id}_${file.name}`));
                writeFileSync(filePath, Buffer.from(await ((await fetch(file.url)).arrayBuffer())));
                attachments.push({
                    name: file.name,
                    description: file.description,
                    filePath
                });
            } catch(e) {
                log.warn({
                    error: e,
                    file
                }, "Couldn't log attachment");
            }
        }
    }

    await loggedMessage.update({ attachments: JSON.stringify(attachments) });
    log.trace(`Logged message ${message.id}`);
});

client.on(Events.MessageDelete, async (partialMessage: OmitPartialGroupDMChannel<Message<boolean> | PartialMessage<boolean>>) => {
    const log = logger.child({ event: "MessageDelete" });
    const messageInfo = await LoggedMessage.findOne({
        where: {
            id: partialMessage.id
        }
    });

    if (!messageInfo) return log.trace(`No log matches ${partialMessage.id}`);

    const messageAttachments: Attachment[] = JSON.parse(messageInfo.attachments);
    let guildInfo: Guild = await client.guilds.fetch(messageInfo.guildId);
    let messageAuthor: string | User | GuildMember = messageInfo.authorId;
    let files: AttachmentBuilder[] = [];

    for(const file of messageAttachments)
        files.push(new AttachmentBuilder(readFileSync(file.filePath), {
            name: file.name,
            description: file.description || ""
        }));

    
    try {
        messageAuthor = await guildInfo.members.fetch(messageAuthor.toString());
    } catch(_) {
        try {
            messageAuthor = await client.users.fetch(messageAuthor.toString());
        } catch(_) {}
    }

    let messageAuthorName = messageAuthor instanceof GuildMember ? messageAuthor.displayName : 'unknown';

    const embed = new EmbedBuilder();
    if (messageInfo.content) embed.setDescription(messageInfo.content);
    embed.setAuthor({
        name: messageAuthorName,
        iconURL: messageAuthor instanceof GuildMember ? messageAuthor.avatarURL() ?? undefined : undefined
    });
    embed.setFooter({
        text: `ID: ${partialMessage.id} - Timestamp: ${messageInfo.createdAt}`
    });
    embed.setColor(Colors.Red);

    if (botConfig.logChannel) {
        const unsentLogChannel = await client.channels.fetch(botConfig.logChannel);
        if (unsentLogChannel?.isSendable()) {
            embed.setTitle(`Unsent a message in <#${partialMessage.channelId}>`);
            await unsentLogChannel.send({
                embeds: [embed],
                files
            });
        }
    }

    if (botConfig.resendUnsent) {
        const unsentLogChannel = await client.channels.fetch(partialMessage.channelId);
        if (unsentLogChannel?.isSendable()) {
            embed.setTitle(`Unsent a message`);
            await unsentLogChannel.send({
                embeds: [embed],
                files
            });
        }
    }

    
    for(const file of messageAttachments) {
        try {
            unlinkSync(file.filePath);
        } catch(e) {
            log.warn({
                error: e,
                file
            }, "Failed to delete");
        }
    }
    
    await LoggedMessage.destroy({
        where: {
            id: partialMessage.id
        }
    });
});
//!SECTION

(async () => {
    const log = logger.child({ event: "Initialization" });

    if (!process.env.DISCORD_TOKEN) throw new TypeError("You didn't provide a discord token!");
    else if (!botConfig.logChannel && !botConfig.resendUnsent) throw new TypeError("You must provide at least one or both of the following: logChannel or resendUnsent");

    log.info("Attempting to authenticate to database");
    await sequelize.authenticate();
    await sequelize.sync();
    
    log.info("Attempting to login to discord...");
    client.login(process.env.DISCORD_TOKEN);
})();