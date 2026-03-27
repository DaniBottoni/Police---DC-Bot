const { Client, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers
    ]
});

// Store configurations per guild
const configPath = path.join(__dirname, 'config.json');
const warningsPath = path.join(__dirname, 'warnings.json');
let guildConfigs = {};
let activeWarnings = {};

// Load saved configs
if (fs.existsSync(configPath)) {
    guildConfigs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

// Load saved warnings
if (fs.existsSync(warningsPath)) {
    activeWarnings = JSON.parse(fs.readFileSync(warningsPath, 'utf8'));
}

// Save configs to file
function saveConfigs() {
    fs.writeFileSync(configPath, JSON.stringify(guildConfigs, null, 2));
}

// Save warnings to file
function saveWarnings() {
    fs.writeFileSync(warningsPath, JSON.stringify(activeWarnings, null, 2));
}

// Active warning timers (in-memory, not persisted)
const warningTimers = new Map();

// Schedule warning removal
async function scheduleWarningRemoval(warningKey, guildId, userId, roleId, expiresAt, channelId) {
    const now = Date.now();
    const timeLeft = expiresAt - now;
    
    // If already expired, remove immediately
    if (timeLeft <= 0) {
        try {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) return;
            
            const member = await guild.members.fetch(userId).catch(() => null);
            const role = guild.roles.cache.get(roleId);
            
            if (member && role && member.roles.cache.has(roleId)) {
                await member.roles.remove(role);
                
                const channel = guild.channels.cache.get(channelId);
                if (channel) {
                    const embed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('✅ Warning Expired')
                        .setDescription(`<@${userId}>'s warning has expired and the role has been removed.`)
                        .setTimestamp();
                    
                    await channel.send({ embeds: [embed] });
                }
            }
        } catch (error) {
            console.error(`Failed to remove expired role: ${error}`);
        }
        
        delete activeWarnings[warningKey];
        saveWarnings();
        return;
    }
    
    // Schedule removal
    const timeoutId = setTimeout(async () => {
        try {
            const guild = client.guilds.cache.get(guildId);
            if (!guild) return;
            
            const member = await guild.members.fetch(userId).catch(() => null);
            const role = guild.roles.cache.get(roleId);
            
            if (member && role && member.roles.cache.has(roleId)) {
                await member.roles.remove(role);
                
                const channel = guild.channels.cache.get(channelId);
                if (channel) {
                    const embed = new EmbedBuilder()
                        .setColor('#00ff00')
                        .setTitle('✅ Warning Expired')
                        .setDescription(`<@${userId}>'s warning has expired and the role has been removed.`)
                        .setTimestamp();
                    
                    await channel.send({ embeds: [embed] });
                }
            }
        } catch (error) {
            console.error(`Failed to remove role, make sure the Police role is abouve the warning roles: ${error}`);
        }
        
        warningTimers.delete(warningKey);
        delete activeWarnings[warningKey];
        saveWarnings();
    }, timeLeft);
    
    warningTimers.set(warningKey, timeoutId);
}

client.once('ready', () => {
    console.log(`✅ Police bot is online as ${client.user.tag}`);
    
    // Restore active warnings
    console.log(`🔄 Restoring ${Object.keys(activeWarnings).length} active warnings...`);
    for (const [warningKey, warningData] of Object.entries(activeWarnings)) {
        scheduleWarningRemoval(
            warningKey,
            warningData.guildId,
            warningData.userId,
            warningData.roleId,
            warningData.expiresAt,
            warningData.channelId
        );
    }
    
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

            // Schedule role removal with persistent storage
            const warningKey = `${guildId}-${user.id}-${level}-${Date.now()}`;
            const expiresAt = Date.now() + (config.duration * 60 * 1000);
            
            activeWarnings[warningKey] = {
                guildId: guildId,
                userId: user.id,
                roleId: role.id,
                level: level,
                expiresAt: expiresAt,
                channelId: interaction.channel.id
            };
            
            saveWarnings();
            scheduleWarningRemoval(warningKey, guildId, user.id, role.id, expiresAt, interaction.channel.id);

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

// Simple HTTP server to keep Render happy
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Police bot is running!');
});

server.listen(PORT, () => {
    console.log(`🌐 HTTP server listening on port ${PORT}`);
});
