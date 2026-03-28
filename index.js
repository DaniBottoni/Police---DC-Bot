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

// Auto-save config to GitHub (requires GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO env vars)
async function saveConfigToGitHub() {
    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    
    // Skip if GitHub integration not configured
    if (!token || !owner || !repo) {
        console.log('⚠️ GitHub auto-save disabled (missing GITHUB_TOKEN, GITHUB_OWNER, or GITHUB_REPO)');
        return false;
    }
    
    try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const base64Content = Buffer.from(configContent).toString('base64');
        
        // Get current file SHA (required for updates)
        const getResponse = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/config.json`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'User-Agent': 'Police-Discord-Bot'
                }
            }
        );
        
        let sha = null;
        if (getResponse.ok) {
            const data = await getResponse.json();
            sha = data.sha;
        }
        
        // Update file on GitHub
        const updateData = {
            message: 'Auto-save: Update config.json from Discord bot',
            content: base64Content,
            branch: 'main' // Change to 'master' if your default branch is master
        };
        
        if (sha) {
            updateData.sha = sha;
        }
        
        const updateResponse = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/config.json`,
            {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json',
                    'User-Agent': 'Police-Discord-Bot'
                },
                body: JSON.stringify(updateData)
            }
        );
        
        if (updateResponse.ok) {
            console.log('✅ Config auto-saved to GitHub');
            return true;
        } else {
            const errorData = await updateResponse.json();
            console.error('❌ GitHub save failed:', errorData.message);
            return false;
        }
    } catch (error) {
        console.error('❌ GitHub auto-save error:', error.message);
        return false;
    }
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
            } else if (member && role && !member.roles.cache.has(roleId)) {
                console.log(`User ${userId} no longer has role ${roleId}`);
            }
        } catch (error) {
            console.error(`Failed to remove expired role: ${error}`);
            
            // Try to notify in channel about the error
            try {
                const guild = client.guilds.cache.get(guildId);
                const channel = guild?.channels.cache.get(channelId);
                if (channel) {
                    const errorEmbed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('❌ Warning Removal Failed')
                        .setDescription(`Could not remove role from <@${userId}>. Check bot permissions and role hierarchy.`)
                        .addFields({ name: 'Error', value: error.message || 'Unknown error' })
                        .setTimestamp();
                    
                    await channel.send({ embeds: [errorEmbed] });
                }
            } catch (notifyError) {
                console.error(`Could not send error notification: ${notifyError}`);
            }
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
            } else if (member && role && !member.roles.cache.has(roleId)) {
                console.log(`User ${userId} no longer has role ${roleId}`);
            }
        } catch (error) {
            console.error(`Failed to remove role: ${error}`);
            
            // Try to notify in channel about the error
            try {
                const guild = client.guilds.cache.get(guildId);
                const channel = guild?.channels.cache.get(channelId);
                if (channel) {
                    const errorEmbed = new EmbedBuilder()
                        .setColor('#ff0000')
                        .setTitle('❌ Warning Removal Failed')
                        .setDescription(`Could not remove role from <@${userId}>. Check bot permissions and role hierarchy.`)
                        .addFields({ name: 'Error', value: error.message || 'Unknown error' })
                        .setTimestamp();
                    
                    await channel.send({ embeds: [errorEmbed] });
                }
            } catch (notifyError) {
                console.error(`Could not send error notification: ${notifyError}`);
            }
        }
        
        warningTimers.delete(warningKey);
        delete activeWarnings[warningKey];
        saveWarnings();
    }, timeLeft);
    
    warningTimers.set(warningKey, timeoutId);
}

// Keep Render alive by self-pinging every 14 minutes
function keepAlive() {
    const pingServer = () => {
        const url = process.env.RENDER_EXTERNAL_URL 
            ? `${process.env.RENDER_EXTERNAL_URL}` 
            : `http://localhost:${process.env.PORT || 3000}`;
        
        try {
            http.get(url, (res) => {
                console.log(`🏓 Keep-alive ping - Status: ${res.statusCode}`);
            }).on('error', (err) => {
                console.error('❌ Keep-alive ping failed:', err.message);
            });
        } catch (error) {
            console.error('❌ Keep-alive error:', error.message);
        }
    };
    
    // Ping immediately on startup to prevent initial spin-down
    console.log('🏓 Sending initial keep-alive ping...');
    setTimeout(pingServer, 5000); // 5 second delay to let server start
    
    // Then ping every 14 minutes
    setInterval(pingServer, 14 * 60 * 1000);
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
    
    // Start keep-alive pings to prevent Render from spinning down
    keepAlive();
    console.log('🏓 Keep-alive system started (14-minute intervals)');
    
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
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        
        new SlashCommandBuilder()
            .setName('exportconfig')
            .setDescription('Download config.json file to upload to GitHub')
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
        
        // Auto-save to GitHub (non-blocking)
        saveConfigToGitHub().then(success => {
            if (success) {
                console.log('✅ Config synced to GitHub automatically');
            }
        });

        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🚨 Warning Configuration Updated')
            .addFields(
                { name: 'Level', value: `${level}`, inline: true },
                { name: 'Role', value: `${role}`, inline: true },
                { name: 'Duration', value: `${duration} minutes`, inline: true }
            )
            .setFooter({ text: 'Config auto-saved to GitHub ✓' })
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

        // Check if bot can manage this role
        const botMember = interaction.guild.members.me;
        if (role.position >= botMember.roles.highest.position) {
            return interaction.reply({
                content: `❌ I cannot manage the ${role} role. My highest role must be **above** the warning role in the server's role list.\n\n**Fix:** Drag my role higher than ${role} in Server Settings → Roles.`,
                ephemeral: true
            });
        }

        if (!botMember.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return interaction.reply({
                content: `❌ I don't have the "Manage Roles" permission. Please enable it in Server Settings → Roles.`,
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

    else if (commandName === 'exportconfig') {
        if (!guildConfigs[guildId] || Object.keys(guildConfigs[guildId].levels).length === 0) {
            return interaction.reply({
                content: '❌ No warning levels configured yet. Use /config to set them up first.',
                ephemeral: true
            });
        }

        // Create a buffer from the config file
        const configContent = fs.readFileSync(configPath, 'utf8');
        const buffer = Buffer.from(configContent, 'utf8');

        await interaction.reply({
            content: '📥 Here\'s your `config.json` file!\n\n**Next steps:**\n1. Download this file\n2. Go to your GitHub repo\n3. Upload/replace `config.json`\n4. Commit the changes\n5. Your configs will now persist across restarts! 🎉',
            files: [{
                attachment: buffer,
                name: 'config.json'
            }],
            ephemeral: true
        });
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
