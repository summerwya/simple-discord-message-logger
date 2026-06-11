import type { Channel } from "discord.js"

export type Shared = {
    logChannel: Channel | null
}

export type Attachment = {
    filePath: string,
    name: string,
    description: string | null
}