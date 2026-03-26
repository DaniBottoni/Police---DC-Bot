const { Client, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// Store configurations per guild
const configPath = path.join(__dirname, 'config.json');
let guildConfigs = {};

// Load saved configs
if (fs.existsSync(configPath)) {
    guildConfigs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

// Save configs to file
function saveConfigs() {
    fs.writeFileSync(configPath, JSON.stringify(guildConfigs, null, 2));
}

// Active warnings tracker
const activeWarnings = new Map();

client.once('ready', () => {
    console.log(`✅ Police bot is online as ${client.user.tag}`);
    
    // Register slash commands
    const commands = [
        new SlashCommandBuilder()
            .setName('config')
            .setDescription('Configure warning levels, roles, and durations')
            .addIntegerOption(option =>
                option.setName('level')
                    .setDescription('Warning level (1, 2, 3, etc.)')
                    .setRequired(true))
            .addRoleOption(option =>
                option.setName('role')
                    .setDescription('Role to assign for this warning level')
                    .setRequired(true))
            .addIntegerOption(option =>
                option.setName('duration')
                    .setDescription('Duration in minutes before role is removed')
                    .setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        
        new SlashCommandBuilder()
            .setName('warn')
            .setDescription('Give a warning to a user')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('User to warn')
                    .setRequired(true))
            .addIntegerOption(option =>
                option.setName('level')
                    .setDescription('Warning level')
                    .setRequired(true))
            .addStringOption(option =>
                option.setName('reason')
                    .setDescription('Reason for the warning')
                    .setRequired(false))
            .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
        
        new SlashCommandBuilder()
            .setName('viewconfig')
            .setDescription('View current warning configuration')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    ].map(command => command.toJSON());

    // Register commands globally
    client.application.commands.set(commands);
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const { commandName, guildId } = interaction;

    // Initialize guild config if doesn't exist
    if (!guildConfigs[guildId]) {
        guildConfigs[guildId] = { levels: {} };
    }

    if (commandName === 'config') {
        const level = interaction.options.getInteger('level');
        const role = interaction.options.getRole('role');
        const duration = interaction.options.getInteger('duration');

        guildConfigs[guildId].levels[level] = {
            roleId: role.id,
            roleName: role.name,
            duration: duration
        };

        saveConfigs();

        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🚨 Warning Configuration Updated')
            .addFields(
                { name: 'Level', value: `${level}`, inline: true },
                { name: 'Role', value: `${role}`, inline: true },
                { name: 'Duration', value: `${duration} minutes`, inline: true }
            )
            .setTimestamp();

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'warn') {
        const user = interaction.options.getUser('user');
        const member = interaction.guild.members.cache.get(user.id);
        const level = interaction.options.getInteger('level');
        const reason = interaction.options.getString('reason') || 'No reason provided';

        // Check if level is configured
        if (!guildConfigs[guildId].levels[level]) {
            return interaction.reply({
                content: `❌ Warning level ${level} is not configured. Use /config to set it up.`,
                ephemeral: true
            });
        }

        const config = guildConfigs[guildId].levels[level];
        const role = interaction.guild.roles.cache.get(config.roleId);

        if (!role) {
            return interaction.reply({
                content: `❌ Configured role not found. Please update the configuration.`,
                ephemeral: true
            });
        }

        try {
            // Add role to user
            await member.roles.add(role);

            const embed = new EmbedBuilder()
                .setColor('#ff0000')
                .setTitle('⚠️ Warning Issued')
                .addFields(
                    { name: 'User', value: `${user}`, inline: true },
                    { name: 'Level', value: `${level}`, inline: true },
                    { name: 'Role', value: `${role}`, inline: true },
                    { name: 'Duration', value: `${config.duration} minutes`, inline: true },
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Issued by', value: `${interaction.user}`, inline: false }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

            // Schedule role removal
            const warningKey = `${guildId}-${user.id}-${level}-${Date.now()}`;
            const timeoutId = setTimeout(async () => {
                try {
                    await member.roles.remove(role);
                    activeWarnings.delete(warningKey);
                    
                    // Notify in channel
                    const removalEmbed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('✅ Warning Expired')
                        .setDescription(`${user}'s level ${level} warning has expired and the role has been removed.`)
                        .setTimestamp();
                    
                    await interaction.channel.send({ embeds: [removalEmbed] });
                } catch (error) {
                    console.error(`Failed to remove role: ${error}`);
                }
            }, config.duration * 60 * 1000);

            activeWarnings.set(warningKey, {
                timeoutId,
                userId: user.id,
                roleId: role.id,
                level,
                expiresAt: Date.now() + (config.duration * 60 * 1000)
            });

        } catch (error) {
            console.error(error);
            await interaction.reply({
                content: `❌ Failed to assign warning. Make sure the bot has proper permissions.`,
                ephemeral: true
            });
        }
    }

    else if (commandName === 'viewconfig') {
        const config = guildConfigs[guildId];
        
        if (!config || Object.keys(config.levels).length === 0) {
            return interaction.reply({
                content: '📋 No warning levels configured yet. Use /config to set them up.',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setTitle('🚨 Police Bot Configuration')
            .setDescription('Current warning level settings:')
            .setTimestamp();

        for (const [level, data] of Object.entries(config.levels)) {
            embed.addFields({
                name: `Level ${level}`,
                value: `Role: <@&${data.roleId}>\nDuration: ${data.duration} minutes`,
                inline: true
            });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }
});

// Login with bot token
client.login(process.env.DISCORD_TOKEN);
