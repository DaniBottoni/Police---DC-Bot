const { Client, GatewayIntentBits, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, RoleSelectMenuBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

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
    
    console.log('📤 GitHub auto-save triggered...');
    console.log(`   Token: ${token ? 'Set ✓' : 'Missing ✗'}`);
    console.log(`   Owner: ${owner || 'Missing ✗'}`);
    console.log(`   Repo: ${repo || 'Missing ✗'}`);
    
    // Skip if GitHub integration not configured
    if (!token || !owner || !repo) {
        console.log('⚠️ GitHub auto-save disabled (missing GITHUB_TOKEN, GITHUB_OWNER, or GITHUB_REPO)');
        return false;
    }
    
    try {
        const configContent = fs.readFileSync(configPath, 'utf8');
        const base64Content = Buffer.from(configContent).toString('base64');
        
        console.log('📡 Fetching current file from GitHub...');
        
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
            console.log(`   Found existing file (SHA: ${sha.substring(0, 7)}...)`);
        } else {
            console.log('   File not found, will create new');
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
        
        console.log('📤 Pushing to GitHub...');
        
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
            console.log('✅ Config auto-saved to GitHub successfully!');
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

// Auto-save warnings to GitHub (same env vars as config)
async function saveWarningsToGitHub() {
    const token = process.env.GITHUB_TOKEN;
    const owner = process.env.GITHUB_OWNER;
    const repo = process.env.GITHUB_REPO;
    
    // Skip if GitHub integration not configured
    if (!token || !owner || !repo) {
        return false;
    }
    
    try {
        const warningsContent = fs.readFileSync(warningsPath, 'utf8');
        const base64Content = Buffer.from(warningsContent).toString('base64');
        
        // Get current file SHA (required for updates)
        const getResponse = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/warnings.json`,
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
            message: 'Auto-save: Update warnings.json from Discord bot',
            content: base64Content,
            branch: 'main'
        };
        
        if (sha) {
            updateData.sha = sha;
        }
        
        const updateResponse = await fetch(
            `https://api.github.com/repos/${owner}/${repo}/contents/warnings.json`,
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
            console.log('💾 Warnings auto-saved to GitHub');
            return true;
        } else {
            const errorData = await updateResponse.json();
            console.error('❌ Warning save failed:', errorData.message);
            return false;
        }
    } catch (error) {
        console.error('❌ Warning GitHub save error:', error.message);
        return false;
    }
}

// Save warnings to file
function saveWarnings() {
    fs.writeFileSync(warningsPath, JSON.stringify(activeWarnings, null, 2));
    
    // Also save to GitHub (non-blocking)
    saveWarningsToGitHub().catch(err => {
        console.error('Warning GitHub save failed silently:', err.message);
    });
}

// Show access control configuration UI
async function showAccessControlConfig(target, guildId) {
    const embed = new EmbedBuilder()
        .setColor('#5865F2')
        .setTitle('🔒 Access Control Configuration')
        .setDescription('Select which role should have access to moderation commands:\n\n**Commands affected:**\n• `/warn` - Give warnings to users\n• `/unwarn` - Remove warnings from users\n• `/config` - Configure warning levels\n• `/viewconfig` - View warning configuration\n• `/accessconfig` - Change access control settings\n\n**Note:** Server administrators always have access to all commands.')
        .setFooter({ text: 'Select a role from the menu below' });

    const selectMenu = new RoleSelectMenuBuilder()
        .setCustomId(`access_role_${guildId}`)
        .setPlaceholder('Select a role for command access')
        .setMinValues(1)
        .setMaxValues(1);

    const row = new ActionRowBuilder().addComponents(selectMenu);

    await target.reply({
        embeds: [embed],
        components: [row],
        ephemeral: true
    });
}

// Check if user has permission to use restricted commands
function hasCommandPermission(interaction, guildId) {
    const member = interaction.member;
    
    // Administrators always have access
    if (member.permissions.has(PermissionFlagsBits.Administrator)) {
        return true;
    }
    
    // Check if access role is configured for this guild
    const accessRoleId = guildConfigs[guildId]?.accessRoleId;
    
    // If no access role is configured, only allow administrators
    if (!accessRoleId) {
        return false;
    }
    
    // Check if user has the access role
    return member.roles.cache.has(accessRoleId);
}

// Parse duration string (supports multiple formats)
// Examples: "5" (5 min), "30:0" (30 min), "1:30:0" (1hr 30min), "2:1:30:0" (2d 1hr 30min), "forever" (permanent)
function parseDuration(durationStr) {
    // Check for "forever" option
    if (durationStr.toLowerCase() === 'forever') {
        return { days: 0, hours: 0, minutes: 0, seconds: 0, totalMs: null, isForever: true };
    }
    
    const parts = durationStr.split(':').map(p => parseInt(p.trim()));
    
    if (parts.some(isNaN)) {
        return null; // Invalid input
    }
    
    let days = 0, hours = 0, minutes = 0, seconds = 0;
    
    if (parts.length === 1) {
        minutes = parts[0]; // "5" = 5 minutes (backward compatible)
    } else if (parts.length === 2) {
        minutes = parts[0];
        seconds = parts[1]; // "5:30" = 5 minutes 30 seconds
    } else if (parts.length === 3) {
        hours = parts[0];
        minutes = parts[1];
        seconds = parts[2]; // "1:30:15" = 1 hour 30 minutes 15 seconds
    } else if (parts.length === 4) {
        days = parts[0];
        hours = parts[1];
        minutes = parts[2];
        seconds = parts[3]; // "2:1:30:0" = 2 days 1 hour 30 minutes
    } else {
        return null; // Too many parts
    }
    
    // Convert to milliseconds
    const totalMs = (days * 24 * 60 * 60 * 1000) +
                   (hours * 60 * 60 * 1000) +
                   (minutes * 60 * 1000) +
                   (seconds * 1000);
    
    return { days, hours, minutes, seconds, totalMs, isForever: false };
}

// Format duration for display
function formatDuration(days, hours, minutes, seconds, isForever = false) {
    if (isForever) {
        return 'Forever';
    }
    
    const parts = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0) parts.push(`${seconds}s`);
    return parts.length > 0 ? parts.join(' ') : '0s';
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
        
        // Use https module for https:// URLs, http for http://
        const protocol = url.startsWith('https://') ? https : http;
        
        try {
            protocol.get(url, (res) => {
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
            .addStringOption(option =>
                option.setName('duration')
                    .setDescription('day:hour:min:sec or "forever" for permanent warnings')
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
            .setName('unwarn')
            .setDescription('Manually remove a warning role from a user')
            .addUserOption(option =>
                option.setName('user')
                    .setDescription('User to remove warning from')
                    .setRequired(true))
            .addIntegerOption(option =>
                option.setName('level')
                    .setDescription('Warning level to remove')
                    .setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),
        
        new SlashCommandBuilder()
            .setName('exportconfig')
            .setDescription('Download config.json file to upload to GitHub')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        
        new SlashCommandBuilder()
            .setName('accessconfig')
            .setDescription('Configure which role can access moderation commands')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
        
        new SlashCommandBuilder()
            .setName('timeleft')
            .setDescription('Check how much time is left on your warnings')
    ].map(command => command.toJSON());

    // Register commands globally
    client.application.commands.set(commands);
});

// Handle bot joining a new server
client.on('guildCreate', async guild => {
    console.log(`🎉 Bot joined new server: ${guild.name} (${guild.id})`);
    
    // Initialize guild config
    if (!guildConfigs[guild.id]) {
        guildConfigs[guild.id] = { levels: {} };
        saveConfigs();
    }
    
    try {
        // Try to find who invited the bot using audit logs
        const auditLogs = await guild.fetchAuditLogs({
            type: 28, // INTEGRATION_CREATE / BOT_ADD
            limit: 5
        });
        
        // Find the most recent bot add entry for this bot
        const botAddEntry = auditLogs.entries.find(entry => 
            entry.target?.id === client.user.id &&
            Date.now() - entry.createdTimestamp < 60000 // Within last minute
        );
        
        if (botAddEntry && botAddEntry.executor) {
            const inviter = botAddEntry.executor;
            console.log(`   Invited by: ${inviter.tag} (${inviter.id})`);
            
            // Send DM to the person who invited the bot
            try {
                await showAccessControlConfig(inviter, guild.id);
                console.log(`   ✅ Sent access config DM to ${inviter.tag}`);
            } catch (dmError) {
                console.log(`   ⚠️ Could not DM ${inviter.tag}, they may have DMs disabled`);
                
                // Try to send in system channel as fallback
                if (guild.systemChannel) {
                    try {
                        const embed = new EmbedBuilder()
                            .setColor('#5865F2')
                            .setTitle('👋 Thanks for adding Police Bot!')
                            .setDescription(`${inviter}, please run \`/accessconfig\` to set up command permissions.`)
                            .setFooter({ text: 'This bot uses role-based access control for moderation commands' });
                        
                        await guild.systemChannel.send({ embeds: [embed] });
                        console.log(`   ✅ Sent access config reminder in system channel`);
                    } catch (channelError) {
                        console.log(`   ⚠️ Could not send in system channel either`);
                    }
                }
            }
        } else {
            console.log(`   ⚠️ Could not determine who invited the bot`);
        }
    } catch (error) {
        console.error(`   ❌ Error in guildCreate handler:`, error.message);
    }
});

client.on('interactionCreate', async interaction => {
    // Handle role select menu interactions (for access control configuration)
    if (interaction.isRoleSelectMenu()) {
        if (interaction.customId.startsWith('access_role_')) {
            const guildId = interaction.customId.replace('access_role_', '');
            const selectedRole = interaction.roles.first();
            
            // Save the access role to config
            if (!guildConfigs[guildId]) {
                guildConfigs[guildId] = { levels: {} };
            }
            
            guildConfigs[guildId].accessRoleId = selectedRole.id;
            saveConfigs();
            
            // Auto-save to GitHub
            await saveConfigToGitHub();
            
            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ Access Control Updated')
                .setDescription(`Members with the ${selectedRole} role can now use moderation commands.\n\n**Affected commands:**\n• \`/warn\`\n• \`/unwarn\`\n• \`/config\`\n• \`/viewconfig\`\n• \`/accessconfig\`\n\n*Server administrators always have access.*`)
                .setTimestamp();
            
            await interaction.update({ embeds: [embed], components: [] });
            console.log(`🔒 Access role set to ${selectedRole.name} in ${interaction.guild.name}`);
        }
        return;
    }
    
    // Handle slash commands
    if (!interaction.isChatInputCommand()) return;

    const { commandName, guildId } = interaction;

    // Initialize guild config if doesn't exist
    if (!guildConfigs[guildId]) {
        guildConfigs[guildId] = { levels: {} };
    }
    
    // Commands that require special access control
    const restrictedCommands = ['config', 'warn', 'unwarn', 'viewconfig', 'accessconfig'];
    
    // Check permissions for restricted commands
    if (restrictedCommands.includes(commandName)) {
        if (!hasCommandPermission(interaction, guildId)) {
            const accessRole = guildConfigs[guildId]?.accessRoleId;
            const accessRoleDisplay = accessRole ? `<@&${accessRole}>` : 'not configured';
            
            return interaction.reply({
                content: `❌ You don't have permission to use this command.\n\n**Required:** Administrator permission OR ${accessRoleDisplay}\n\nAsk a server administrator to run \`/accessconfig\` to set up command access.`,
                ephemeral: true
            });
        }
    }

    if (commandName === 'accessconfig') {
        await showAccessControlConfig(interaction, guildId);
    }

    else if (commandName === 'config') {
        const level = interaction.options.getInteger('level');
        const role = interaction.options.getRole('role');
        const durationStr = interaction.options.getString('duration');
        
        // Parse duration
        const duration = parseDuration(durationStr);
        
        if (!duration) {
            return interaction.reply({
                content: '❌ Invalid duration format. Use:\n• `5` (5 minutes)\n• `30:0` (30 minutes)\n• `1:30:0` (1 hour 30 minutes)\n• `2:1:30:0` (2 days 1 hour 30 minutes)\n• `forever` (permanent warning)',
                ephemeral: true
            });
        }

        guildConfigs[guildId].levels[level] = {
            roleId: role.id,
            roleName: role.name,
            durationMs: duration.totalMs,
            isForever: duration.isForever,
            durationDisplay: formatDuration(duration.days, duration.hours, duration.minutes, duration.seconds, duration.isForever)
        };

        saveConfigs();
        
        // Auto-save to GitHub (non-blocking)
        saveConfigToGitHub();

        const embed = new EmbedBuilder()
            .setColor('#00ff00')
            .setTitle('🚨 Warning Configuration Updated')
            .addFields(
                { name: 'Level', value: `${level}`, inline: true },
                { name: 'Role', value: `${role}`, inline: true },
                { name: 'Duration', value: formatDuration(duration.days, duration.hours, duration.minutes, duration.seconds, duration.isForever), inline: true }
            )
            .setFooter({ text: 'Config saved locally (check logs for GitHub sync)' })
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
                    { name: 'Duration', value: config.durationDisplay || 'Unknown', inline: true },
                    { name: 'Reason', value: reason, inline: false },
                    { name: 'Issued by', value: `${interaction.user}`, inline: false }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

            // Only schedule removal if not a forever warning
            if (!config.isForever) {
                // Schedule role removal with persistent storage
                const warningKey = `${guildId}-${user.id}-${level}-${Date.now()}`;
                const expiresAt = Date.now() + config.durationMs;
                
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
            } else {
                console.log(`⏰ Warning issued to ${user.tag} with permanent duration (no auto-removal)`);
            }

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
                value: `Role: <@&${data.roleId}>\nDuration: ${data.durationDisplay || `${data.duration} minutes (old format)`}`,
                inline: true
            });
        }

        await interaction.reply({ embeds: [embed], ephemeral: true });
    }

    else if (commandName === 'unwarn') {
        const user = interaction.options.getUser('user');
        const member = interaction.guild.members.cache.get(user.id);
        const level = interaction.options.getInteger('level');

        // Check if level is configured
        if (!guildConfigs[guildId].levels[level]) {
            return interaction.reply({
                content: `❌ Warning level ${level} is not configured.`,
                ephemeral: true
            });
        }

        const config = guildConfigs[guildId].levels[level];
        const role = interaction.guild.roles.cache.get(config.roleId);

        if (!role) {
            return interaction.reply({
                content: `❌ Configured role not found.`,
                ephemeral: true
            });
        }

        // Check if user has the role
        if (!member.roles.cache.has(role.id)) {
            return interaction.reply({
                content: `❌ ${user} doesn't have the ${role} role.`,
                ephemeral: true
            });
        }

        try {
            // Remove role from user
            await member.roles.remove(role);

            // Remove from active warnings if exists
            const warningKeys = Object.keys(activeWarnings).filter(key => {
                const warning = activeWarnings[key];
                return warning.userId === user.id && warning.guildId === guildId && warning.level === level;
            });

            warningKeys.forEach(key => {
                // Clear timer if exists
                if (warningTimers.has(key)) {
                    clearTimeout(warningTimers.get(key));
                    warningTimers.delete(key);
                }
                delete activeWarnings[key];
            });

            if (warningKeys.length > 0) {
                saveWarnings();
            }

            const embed = new EmbedBuilder()
                .setColor('#00ff00')
                .setTitle('✅ Warning Removed')
                .addFields(
                    { name: 'User', value: `${user}`, inline: true },
                    { name: 'Level', value: `${level}`, inline: true },
                    { name: 'Role', value: `${role}`, inline: true },
                    { name: 'Removed by', value: `${interaction.user}`, inline: false }
                )
                .setTimestamp();

            await interaction.reply({ embeds: [embed] });

        } catch (error) {
            console.error(error);
            await interaction.reply({
                content: `❌ Failed to remove warning. Make sure the bot has proper permissions.`,
                ephemeral: true
            });
        }
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
    
    else if (commandName === 'timeleft') {
        const userId = interaction.user.id;
        
        // Find all warnings for this user in this guild
        const userWarnings = Object.entries(activeWarnings).filter(([key, warning]) => 
            warning.guildId === guildId && warning.userId === userId
        );
        
        if (userWarnings.length === 0) {
            return interaction.reply({
                content: '✅ You have no active warnings!',
                ephemeral: true
            });
        }
        
        // Build embed with all warnings
        const embed = new EmbedBuilder()
            .setColor('#FFA500')
            .setTitle('⏰ Your Active Warnings')
            .setDescription(`You currently have ${userWarnings.length} active warning${userWarnings.length > 1 ? 's' : ''}:`)
            .setTimestamp();
        
        for (const [warningKey, warning] of userWarnings) {
            const config = guildConfigs[guildId]?.levels[warning.level];
            const roleName = config?.roleName || 'Unknown Role';
            
            // Check if this is a forever warning
            if (config?.isForever) {
                embed.addFields({
                    name: `Level ${warning.level} - ${roleName}`,
                    value: '⏳ **Duration:** Forever\n🔒 **Status:** Permanent (use `/unwarn` to remove)',
                    inline: false
                });
            } else {
                // Calculate time remaining
                const now = Date.now();
                const timeLeft = warning.expiresAt - now;
                
                if (timeLeft <= 0) {
                    embed.addFields({
                        name: `Level ${warning.level} - ${roleName}`,
                        value: '⏳ **Time Left:** Expired (will be removed shortly)',
                        inline: false
                    });
                } else {
                    // Convert to days, hours, minutes, seconds
                    const totalSeconds = Math.floor(timeLeft / 1000);
                    const days = Math.floor(totalSeconds / 86400);
                    const hours = Math.floor((totalSeconds % 86400) / 3600);
                    const minutes = Math.floor((totalSeconds % 3600) / 60);
                    const seconds = totalSeconds % 60;
                    
                    const timeDisplay = formatDuration(days, hours, minutes, seconds, false);
                    const expiryDate = new Date(warning.expiresAt);
                    const expiryTimestamp = `<t:${Math.floor(warning.expiresAt / 1000)}:F>`;
                    
                    embed.addFields({
                        name: `Level ${warning.level} - ${roleName}`,
                        value: `⏳ **Time Left:** ${timeDisplay}\n📅 **Expires:** ${expiryTimestamp}`,
                        inline: false
                    });
                }
            }
        }
        
        embed.setFooter({ text: 'Warnings are automatically removed when they expire' });
        
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
