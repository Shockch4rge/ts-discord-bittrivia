import { Client, Collection, Message } from "discord.js";
import { SlashCommandBuilder } from "@discordjs/builders";
import fs from 'fs';
import path from 'path';
import CommandInteractionHelper from "./CommandInteractionHelper";
import BotCache from "../db/BotCache";
import SlashCommandDeployer from "./SlashCommandDeployer";
import GuildCache from "../db/GuildCache";
import ButtonInteractionHelper from "./ButtonInteractionHelper";
import { delay } from "../utilities/utils";


export default class BotHelper {
    public readonly bot: Client;
    public readonly botCache: BotCache;
    public readonly messageFiles: Collection<string, Message>;
    public readonly buttonFiles: Collection<string, ButtonFile>;
    public readonly interactionFiles: Collection<string, InteractionFile>;

    public constructor(bot: Client) {
        this.bot = bot;
        this.botCache = new BotCache(this.bot);

        this.messageFiles = new Collection();
        this.interactionFiles = new Collection();
        this.buttonFiles = new Collection();

        this.setupInteractionCommands();
        this.setupButtonCommands();
        this.setupBotEvents();
    }

    private setupBotEvents() {
        // ready
        this.bot.on("ready", async bot => {
            console.log(`${bot.user.tag} is ready!`);

            const guilds = bot.guilds.cache.toJSON();

            for (const guild of guilds) {
                let cache: GuildCache | undefined;

                try {
                    cache = await this.botCache.getGuildCache(guild);
                }
                catch (err) {
                    // @ts-ignore
                    console.error(`❌  Couldn't find ${guild.name}: ${err.message}`);
                    continue;
                }

                // deploy slash commands for each guild
                const deployer = new SlashCommandDeployer(guild.id, this.interactionFiles);

                try {
                    await deployer.deploy();
                }
                catch (err) {
                    // @ts-ignore
                    console.error(`❌  Failed to deploy commands in ${guild.name}: ${err.message}`);
                    continue;
                }

                console.log(`✅  Restored cache for ${guild.name}`);
            }
        });

        // messageCreate
        this.bot.on("messageCreate", async message => {
            if (message.author.bot) return;
            if (!message.guild) return;

            if (/^\|ping/.test(message.content)) {
                await message.reply({ content: `Pong! ${this.bot.ws.ping}ms` });
                return;
            }
        });

        // interactionCreate
        this.bot.on("interactionCreate", async interaction => {
            if (!interaction.guild) return;

            const guildCache = await this.botCache.getGuildCache(interaction.guild);

            // Slash command
            if (interaction.isCommand()) {
                await interaction.deferReply().catch();
                const interactionFile = this.interactionFiles.get(interaction.commandName);
                if (!interactionFile) return;

                const helper = new CommandInteractionHelper(guildCache, interaction);

                try {
                    if (interactionFile.execute) {
                        await interactionFile.execute(helper);
                    }

                }
                catch (err) {
                    console.warn(err);
                    await interaction.followUp({
                        content: "There was an error executing this command!"
                    });
                }
            }

            // Button command
            if (interaction.isButton()) {
                // await interaction.deferReply().catch(err => console.error(err.message));
                const buttonFile = this.buttonFiles.get(interaction.customId);
                if (!buttonFile) return;

                const helper = new ButtonInteractionHelper(guildCache, interaction);

                try {
                    await buttonFile.execute(helper);
                }
                catch (err) {
                    console.warn(err);
                    await interaction.reply({ content: "There was an error executing this button!" });
                    await delay(5000);
                    await interaction.deleteReply();
                }
            }
        });
    }

    private setupInteractionCommands() {
        let fileNames: string[];

        try {
            fileNames = fs.readdirSync(path.join(__dirname, "../commands"))
                .filter(fileName => BotHelper.isFile(fileName));
        }
        catch (err) {
            // @ts-ignore
            console.error(`There was an error reading a file: ${err.message}`);
            return;
        }

        for (const fileName of fileNames) {
            const interactionFile = require(`../commands/${fileName}`) as InteractionFile;
            this.interactionFiles.set(interactionFile.data.name, interactionFile);
        }
    }

    private setupButtonCommands() {
        let fileNames: string[];

        try {
            fileNames = fs.readdirSync(path.join(__dirname, "../buttons"))
                .filter(fileName => BotHelper.isFile(fileName));
        }
        catch (err) {
            // @ts-ignore
            console.error(`There was an error reading a file: ${err.message}`);
            return;
        }

        for (const fileName of fileNames) {
            const buttonFile = require(`../buttons/${fileName}`) as ButtonFile;
            this.buttonFiles.set(buttonFile.id, buttonFile);
        }
    }

    public static isFile(fileName: string) {
        return fileName.endsWith(".ts") || fileName.endsWith(".js");
    }
}

export type InteractionFile = {
    data: SlashCommandBuilder,
    execute: (helper: CommandInteractionHelper) => Promise<any>,
}

export type ButtonFile = {
    id: string,
    execute: (helper: ButtonInteractionHelper) => Promise<any>;
}
