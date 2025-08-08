const { Client, GatewayIntentBits, Events, EmbedBuilder, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes } = require('discord.js');
const VoiceTimerDB = require('./database.js');
const { formatTime, formatJSTDate, parseJSTDateTime, isValidJSTDateTime, toDiscordTimestamp } = require('./utils.js');

// Discordクライアント初期化
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const { token, guildId } = require('./config.json');

// データベース初期化
const db = new VoiceTimerDB();

// ユーザーのセッション管理（メモリ内）
const userSessions = new Map();

// アクティブなタイマーを管理
const activeTimers = new Map();

// AFKチャンネルのキャッシュ
const afkChannelsCache = new Map();

// AFKチャンネルキャッシュを更新
function updateAFKChannelCache(guildId) {
    db.getAFKChannels(guildId, (err, channels) => {
        if (!err) {
            afkChannelsCache.set(guildId, channels || []);
        }
    });
}

// AFKチャンネルかどうかチェック（キャッシュ使用）
function isAfkChannel(guildId, channelId, guild) {
    if (!channelId) return false;
    
    const cachedChannels = afkChannelsCache.get(guildId) || [];
    return cachedChannels.includes(channelId) || guild.afkChannel?.id === channelId;
}

// スラッシュコマンド登録関数
async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('role-reward')
            .setDescription('ロール報酬設定を管理します（サーバー独立）')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('add')
                    .setDescription('ロール報酬を追加')
                    .addIntegerOption(option =>
                        option.setName('hours')
                            .setDescription('必要時間（時間）')
                            .setRequired(true))
                    .addRoleOption(option =>
                        option.setName('role')
                            .setDescription('付与するロール')
                            .setRequired(true)))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('remove')
                    .setDescription('ロール報酬を削除')
                    .addIntegerOption(option =>
                        option.setName('hours')
                            .setDescription('削除する時間設定')
                            .setRequired(true)))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('list')
                    .setDescription('ロール報酬設定一覧を表示')),
        
        new SlashCommandBuilder()
            .setName('afk-channel')
            .setDescription('AFKチャンネル設定を管理します（サーバー独立）')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('add')
                    .setDescription('AFKチャンネルを追加')
                    .addChannelOption(option =>
                        option.setName('channel')
                            .setDescription('AFKチャンネル')
                            .setRequired(true)))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('remove')
                    .setDescription('AFKチャンネルを削除')
                    .addChannelOption(option =>
                        option.setName('channel')
                            .setDescription('削除するAFKチャンネル')
                            .setRequired(true)))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('list')
                    .setDescription('AFKチャンネル一覧を表示')),
        
        new SlashCommandBuilder()
            .setName('ranking')
            .setDescription('このサーバーの通話時間ランキングを表示')
            .addIntegerOption(option =>
                option.setName('page')
                    .setDescription('ページ番号（デフォルト: 1）')
                    .setMinValue(1)),
        
        new SlashCommandBuilder()
            .setName('my-time')
            .setDescription('このサーバーでの自分の通話時間を表示'),
        
        new SlashCommandBuilder()
            .setName('reset-time')
            .setDescription('このサーバーの全ユーザーの通話時間をリセット')
            .addStringOption(option =>
                option.setName('confirm')
                    .setDescription('確認のため "confirm" と入力してください')
                    .setRequired(true))
    ];

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        console.log('スラッシュコマンドを登録中...');
        
        if (guildId) {
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: commands }
            );
            console.log('ギルドコマンドを登録しました');
        } else {
            await rest.put(
                Routes.applicationCommands(client.user.id),
                { body: commands }
            );
            console.log('グローバルコマンドを登録しました');
        }
    } catch (error) {
        console.error('コマンド登録エラー:', error);
    }
}

// ボイス状態更新イベント
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (newState && oldState) {
        const guildId = newState.guild.id;
        const userId = newState.member.id;
        const currentTime = Date.now();
        
        // ボイスチャンネル入室
        if (oldState.channelId == null && newState.channelId != null) {
            console.log(`${newState.member.displayName}が${newState.channel.name}に接続しました (${newState.guild.name})`);

            // AFKチャンネル以外なら時間計測開始
            if (!isAfkChannel(guildId, newState.channelId, newState.guild)) {
                const sessionKey = `${guildId}_${userId}`;
                userSessions.set(sessionKey, {
                    startTime: currentTime,
                    channelId: newState.channelId,
                    guildId: guildId
                });
            }
        }
        
        // ボイスチャンネル退室
        if (oldState.channelId != null && newState.channelId == null) {
            console.log(`${oldState.member.displayName}が${oldState.channel.name}から切断しました (${oldState.guild.name})`);
            
            // セッション終了処理
            const sessionKey = `${guildId}_${userId}`;
            if (userSessions.has(sessionKey) && !isAfkChannel(guildId, oldState.channelId, oldState.guild)) {
                const session = userSessions.get(sessionKey);
                const sessionTime = currentTime - session.startTime;
                
                // データベースに累積時間を追加
                const sessionData = {
                    channelId: session.channelId,
                    startTime: session.startTime,
                    endTime: currentTime
                };
                
                db.addVoiceTime(guildId, userId, sessionTime, sessionData);
                userSessions.delete(sessionKey);
                
                // ロール報酬チェック
                checkRoleRewards(newState.guild, userId);
            }
        }
        
        // ボイスチャンネル移動
        if (oldState.channelId != null && newState.channelId != null && oldState.channelId != newState.channelId) {
            console.log(`${oldState.member.displayName}が${oldState.channel.name}から${newState.channel.name}に移動しました (${newState.guild.name})`);
            
            const sessionKey = `${guildId}_${userId}`;
            
            // 移動先がAFKチャンネルの場合はセッション終了
            if (userSessions.has(sessionKey) && !isAfkChannel(guildId, oldState.channelId, oldState.guild) && isAfkChannel(guildId, newState.channelId, newState.guild)) {
                const session = userSessions.get(sessionKey);
                const sessionTime = currentTime - session.startTime;
                
                const sessionData = {
                    channelId: session.channelId,
                    startTime: session.startTime,
                    endTime: currentTime
                };
                
                db.addVoiceTime(guildId, userId, sessionTime, sessionData);
                userSessions.delete(sessionKey);
                
                checkRoleRewards(newState.guild, userId);
            }
            // AFKチャンネルから通常チャンネルに移動の場合はセッション開始
            else if (isAfkChannel(guildId, oldState.channelId, oldState.guild) && !isAfkChannel(guildId, newState.channelId, newState.guild)) {
                userSessions.set(sessionKey, {
                    startTime: currentTime,
                    channelId: newState.channelId,
                    guildId: guildId
                });
            }
            // 通常チャンネル間の移動の場合はチャンネルIDを更新
            else if (userSessions.has(sessionKey) && !isAfkChannel(guildId, oldState.channelId, oldState.guild) && !isAfkChannel(guildId, newState.channelId, newState.guild)) {
                const session = userSessions.get(sessionKey);
                session.channelId = newState.channelId;
                userSessions.set(sessionKey, session);
            }
        }
    }
});

// ロール報酬チェック関数
async function checkRoleRewards(guild, userId) {
    const guildId = guild.id;
    
    db.getVoiceTime(guildId, userId, (err, voiceData) => {
        if (err || !voiceData) return;
        
        const totalHours = voiceData.total_time / (1000 * 60 * 60);
        const member = guild.members.cache.get(userId);
        if (!member) return;
        
        db.getRoleRewards(guildId, async (err, roleRewards) => {
            if (err || !roleRewards) return;
            
            for (const reward of roleRewards) {
                if (totalHours >= reward.hours) {
                    const role = guild.roles.cache.get(reward.role_id);
                    if (role && !member.roles.cache.has(reward.role_id)) {
                        try {
                            await member.roles.add(role);
                            console.log(`${member.displayName}に${role.name}ロールを付与しました (${guild.name})`);
                            
                            // DMで通知を送信
                            await sendRoleRewardNotification(member, role, totalHours, guild);
                        } catch (error) {
                            console.error(`ロール付与エラー (${member.displayName}):`, error);
                        }
                    }
                }
            }
        });
    });
}

// ロール報酬通知DM送信関数
async function sendRoleRewardNotification(member, role, totalHours, guild) {
    try {
        const embed = new EmbedBuilder()
            .setTitle('🎉 ロール報酬獲得！')
            .setDescription(`おめでとうございます！通話時間の累積により新しいロールを獲得しました。`)
            .addFields(
                { name: '獲得ロール', value: `${role.name}`, inline: true },
                { name: '必要時間', value: `${Math.floor(totalHours)}時間以上`, inline: true },
                { name: 'サーバー', value: `${guild.name}`, inline: true },
                { name: '現在の累積時間', value: `${formatTime(totalHours * 60 * 60 * 1000)}`, inline: false }
            )
            .setColor(role.color || 0x00AE86)
            .setThumbnail(guild.iconURL())
            .setTimestamp()
            .setFooter({ text: `${guild.name} | ${formatJSTDate()} JST`, iconURL: guild.iconURL() });

        await member.send({ embeds: [embed] });
        console.log(`${member.displayName}にロール報酬通知DMを送信しました`);
    } catch (error) {
        console.error(`DM送信エラー (${member.displayName}):`, error);
    }
}

// インタラクション処理
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand() && !interaction.isButton()) return;

    try {
        if (interaction.isChatInputCommand()) {
            await handleSlashCommand(interaction);
        } else if (interaction.isButton()) {
            await handleButtonInteraction(interaction);
        }
    } catch (error) {
        console.error('インタラクションエラー:', error);
        
        try {
            const reply = { content: 'エラーが発生しました。しばらく時間をおいてから再度お試しください。', ephemeral: true };
            
            if (interaction.replied) {
                await interaction.followUp(reply);
            } else if (interaction.deferred) {
                await interaction.editReply(reply);
            } else {
                await interaction.reply(reply);
            }
        } catch (replyError) {
            console.error('エラー応答失敗:', replyError);
        }
    }
});

// スラッシュコマンド処理関数
async function handleSlashCommand(interaction) {
    const { commandName } = interaction;
    const guildId = interaction.guild.id;

    switch (commandName) {
        case 'role-reward':
            await handleRoleRewardCommand(interaction, guildId);
            break;
        case 'afk-channel':
            await handleAfkChannelCommand(interaction, guildId);
            break;
        case 'ranking':
            await handleRankingCommand(interaction, guildId);
            break;
        case 'my-time':
            await handleMyTimeCommand(interaction, guildId);
            break;
        case 'reset-time':
            await handleResetTimeCommand(interaction, guildId);
            break;
    }
}

// ロール報酬コマンド処理
async function handleRoleRewardCommand(interaction, guildId) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
        case 'add':
            const hours = interaction.options.getInteger('hours');
            const role = interaction.options.getRole('role');
            
            db.addRoleReward(guildId, hours, role.id, role.name, (err) => {
                if (err) {
                    if (err.message && err.message.includes('UNIQUE constraint failed')) {
                        interaction.reply({ content: `${hours}時間の設定は既に存在します。`, ephemeral: true });
                    } else {
                        interaction.reply({ content: 'エラーが発生しました。', ephemeral: true });
                    }
                } else {
                    interaction.reply(`✅ ${hours}時間で${role.name}ロールの報酬を追加しました。`);
                }
            });
            break;

        case 'remove':
            const removeHours = interaction.options.getInteger('hours');
            
            db.removeRoleReward(guildId, removeHours, (err) => {
                if (err || !this.changes) {
                    interaction.reply({ content: `${removeHours}時間の設定が見つかりません。`, ephemeral: true });
                } else {
                    interaction.reply(`✅ ${removeHours}時間のロール報酬を削除しました。`);
                }
            });
            break;

        case 'list':
            db.getRoleRewards(guildId, async (err, roleRewards) => {
                if (err || !roleRewards || roleRewards.length === 0) {
                    await interaction.reply('このサーバーにはロール報酬が設定されていません。');
                    return;
                }
                
                const embed = new EmbedBuilder()
                    .setTitle(`🎭 ${interaction.guild.name} のロール報酬設定`)
                    .setColor(0x00AE86)
                    .setDescription(
                        roleRewards
                            .map(r => `**${r.hours}時間** → ${r.role_name}`)
                            .join('\n')
                    );
                
                await interaction.reply({ embeds: [embed] });
            });
            break;
    }
}

// AFKチャンネルコマンド処理
async function handleAfkChannelCommand(interaction, guildId) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
        case 'add':
            const channel = interaction.options.getChannel('channel');
            
            db.addAFKChannel(guildId, channel.id, (err) => {
                if (err) {
                    interaction.reply({ content: `${channel.name}は既にAFKチャンネルに設定されています。`, ephemeral: true });
                } else {
                    updateAFKChannelCache(guildId); // キャッシュ更新
                    interaction.reply(`✅ ${channel.name}をAFKチャンネルに追加しました。`);
                }
            });
            break;

        case 'remove':
            const removeChannel = interaction.options.getChannel('channel');
            
            db.removeAFKChannel(guildId, removeChannel.id, (err) => {
                if (err) {
                    interaction.reply({ content: `${removeChannel.name}はAFKチャンネルに設定されていません。`, ephemeral: true });
                } else {
                    updateAFKChannelCache(guildId); // キャッシュ更新
                    interaction.reply(`✅ ${removeChannel.name}をAFKチャンネルから削除しました。`);
                }
            });
            break;

        case 'list':
            db.getAFKChannels(guildId, async (err, afkChannels) => {
                if (err || !afkChannels || afkChannels.length === 0) {
                    await interaction.reply('このサーバーにはAFKチャンネルが設定されていません。');
                    return;
                }
                
                const channelNames = afkChannels
                    .map(id => interaction.guild.channels.cache.get(id)?.name || '不明なチャンネル')
                    .join('\n');
                
                const embed = new EmbedBuilder()
                    .setTitle(`💤 ${interaction.guild.name} のAFKチャンネル一覧`)
                    .setColor(0x00AE86)
                    .setDescription(channelNames);
                
                await interaction.reply({ embeds: [embed] });
            });
            break;
    }
}

// ランキングコマンド処理
async function handleRankingCommand(interaction, guildId) {
    const page = interaction.options.getInteger('page') || 1;
    const itemsPerPage = 10;
    const offset = (page - 1) * itemsPerPage;
    
    // 総件数を取得
    db.getGuildRankingCount(guildId, async (err, totalCount) => {
        if (err || totalCount === 0) {
            await interaction.reply('このサーバーにはまだ通話時間の記録がありません。');
            return;
        }
        
        const totalPages = Math.ceil(totalCount / itemsPerPage);
        if (page > totalPages) {
            await interaction.reply({ content: `ページ ${page} は存在しません。最大ページ数: ${totalPages}`, ephemeral: true });
            return;
        }
        
        // ランキングデータを取得
        db.getGuildRanking(guildId, itemsPerPage, offset, async (err, rankings) => {
            if (err || !rankings) {
                await interaction.reply('ランキングの取得に失敗しました。');
                return;
            }
            
            // 現在のセッション時間も含めて表示
            const enrichedRankings = rankings.map(ranking => {
                const sessionKey = `${guildId}_${ranking.user_id}`;
                let totalTime = ranking.total_time;
                
                if (userSessions.has(sessionKey)) {
                    const session = userSessions.get(sessionKey);
                    totalTime += Date.now() - session.startTime;
                }
                
                const member = interaction.guild.members.cache.get(ranking.user_id);
                return {
                    userId: ranking.user_id,
                    displayName: member?.displayName || '不明なユーザー',
                    totalTime: totalTime
                };
            });
            
            // 現在のセッション時間を含めて再ソート
            enrichedRankings.sort((a, b) => b.totalTime - a.totalTime);
            
            const description = enrichedRankings
                .map((user, index) => {
                    const rank = offset + index + 1;
                    let rankEmoji = '';
                    if (rank === 1) rankEmoji = '🥇';
                    else if (rank === 2) rankEmoji = '🥈';
                    else if (rank === 3) rankEmoji = '🥉';
                    else rankEmoji = '   ';
                    
                    return `${rankEmoji} **${rank}位** ${user.displayName} - ${formatTime(user.totalTime)}`;
                })
                .join('\n');
            
            const embed = new EmbedBuilder()
                .setTitle(`🏆 ${interaction.guild.name} の通話時間ランキング`)
                .setDescription(description)
                .setColor(0xFFD700)
                .setFooter({ text: `ページ ${page}/${totalPages} | 総ユーザー数: ${totalCount} | ${formatJSTDate()} JST` });
            
            // ページネーションボタン
            const row = new ActionRowBuilder();
            if (page > 1) {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`ranking_${guildId}_${page - 1}`)
                        .setLabel('前のページ')
                        .setStyle(ButtonStyle.Primary)
                );
            }
            if (page < totalPages) {
                row.addComponents(
                    new ButtonBuilder()
                        .setCustomId(`ranking_${guildId}_${page + 1}`)
                        .setLabel('次のページ')
                        .setStyle(ButtonStyle.Primary)
                );
            }
            
            const reply = { embeds: [embed] };
            if (row.components.length > 0) {
                reply.components = [row];
            }
            
            await interaction.reply(reply);
        });
    });
}

// 個人時間コマンド処理
async function handleMyTimeCommand(interaction, guildId) {
    const userId = interaction.user.id;
    
    db.getVoiceTime(guildId, userId, async (err, voiceData) => {
        if (err || !voiceData || voiceData.total_time === 0) {
            await interaction.reply({ content: 'このサーバーではまだ通話時間の記録がありません。', ephemeral: true });
            return;
        }
        
        // 現在のセッション時間を加算
        let currentSessionTime = 0;
        const sessionKey = `${guildId}_${userId}`;
        if (userSessions.has(sessionKey)) {
            const session = userSessions.get(sessionKey);
            currentSessionTime = Date.now() - session.startTime;
        }
        
        const totalTime = voiceData.total_time + currentSessionTime;
        const totalHours = totalTime / (1000 * 60 * 60);
        
        // 次のロール報酬を取得
        db.getRoleRewards(guildId, async (err, roleRewards) => {
            const nextReward = roleRewards?.find(r => totalHours < r.hours);
            const nextRewardText = nextReward 
                ? `\n\n**次のロール報酬:** ${nextReward.role_name} (あと${formatTime((nextReward.hours * 60 * 60 * 1000) - totalTime)})`
                : '\n\n🎉 すべてのロール報酬を獲得済みです！';
            
            const embed = new EmbedBuilder()
                .setTitle(`📊 ${interaction.guild.name} でのあなたの通話時間`)
                .setDescription(`**総通話時間:** ${formatTime(totalTime)}${currentSessionTime > 0 ? `\n**現在のセッション:** ${formatTime(currentSessionTime)}` : ''}${nextRewardText}`)
                .setColor(0x00AE86)
                .setFooter({ text: `${formatJSTDate()} JST` });
            
            await interaction.reply({ embeds: [embed], ephemeral: true });
        });
    });
}

// リセットコマンド処理
async function handleResetTimeCommand(interaction, guildId) {
    const confirm = interaction.options.getString('confirm');
    
    if (confirm !== 'confirm') {
        await interaction.reply({ content: 'リセットを実行するには "confirm" と入力してください。', ephemeral: true });
        return;
    }
    
    // 管理者権限チェック
    if (!interaction.member.permissions.has('ADMINISTRATOR')) {
        await interaction.reply({ content: '❌ このコマンドを使用するには管理者権限が必要です。', ephemeral: true });
        return;
    }
    
    await interaction.reply('⏳ このサーバーの通話時間をリセット中...');
    
    try {
        // データをリセット
        db.resetGuildData(guildId, () => {
            // 現在このサーバーでボイスチャットに参加しているユーザーのセッションをリセット
            const currentTime = Date.now();
            for (const [sessionKey, session] of userSessions.entries()) {
                if (session.guildId === guildId) {
                    userSessions.set(sessionKey, {
                        startTime: currentTime,
                        channelId: session.channelId,
                        guildId: session.guildId
                    });
                }
            }
            
            interaction.editReply(`✅ ${interaction.guild.name} の通話時間リセットが完了しました。`);
        });
        
    } catch (error) {
        console.error('リセット処理エラー:', error);
        await interaction.editReply('❌ リセット処理中にエラーが発生しました。');
    }
}

// ボタンインタラクション処理（堅牢性向上）
async function handleButtonInteraction(interaction) {
    try {
        if (interaction.customId.startsWith('ranking_')) {
            await interaction.deferUpdate();
            
            const parts = interaction.customId.split('_');
            if (parts.length !== 3) {
                throw new Error('無効なボタンID');
            }
            
            const guildId = parts[1];
            const page = parseInt(parts[2]);
            
            if (guildId !== interaction.guild.id) {
                return await interaction.editReply({
                    content: '他のサーバーのランキングボタンです。',
                    embeds: [],
                    components: []
                });
            }
            
            const itemsPerPage = 10;
            const offset = (page - 1) * itemsPerPage;
            
            // 総件数とランキングを取得
            db.getGuildRankingCount(guildId, (err, totalCount) => {
                if (err || totalCount === 0) {
                    return interaction.editReply({
                        content: 'ランキングデータが見つかりません。',
                        embeds: [],
                        components: []
                    });
                }
                
                const totalPages = Math.ceil(totalCount / itemsPerPage);
                
                db.getGuildRanking(guildId, itemsPerPage, offset, async (err, rankings) => {
                    if (err || !rankings) {
                        return interaction.editReply({
                            content: 'ランキングデータの取得に失敗しました。',
                            embeds: [],
                            components: []
                        });
                    }
                    
                    const enrichedRankings = rankings.map(ranking => {
                        const sessionKey = `${guildId}_${ranking.user_id}`;
                        let totalTime = ranking.total_time;
                        
                        if (userSessions.has(sessionKey)) {
                            const session = userSessions.get(sessionKey);
                            totalTime += Date.now() - session.startTime;
                        }
                        
                        const member = interaction.guild.members.cache.get(ranking.user_id);
                        return {
                            userId: ranking.user_id,
                            displayName: member?.displayName || '不明なユーザー',
                            totalTime: totalTime
                        };
                    });
                    
                    enrichedRankings.sort((a, b) => b.totalTime - a.totalTime);
                    
                    const description = enrichedRankings
                        .map((user, index) => {
                            const rank = offset + index + 1;
                            let rankEmoji = '';
                            if (rank === 1) rankEmoji = '🥇';
                            else if (rank === 2) rankEmoji = '🥈';
                            else if (rank === 3) rankEmoji = '🥉';
                            else rankEmoji = '   ';
                            
                            return `${rankEmoji} **${rank}位** ${user.displayName} - ${formatTime(user.totalTime)}`;
                        })
                        .join('\n');
                    
                    const embed = new EmbedBuilder()
                        .setTitle(`🏆 ${interaction.guild.name} の通話時間ランキング`)
                        .setDescription(description)
                        .setColor(0xFFD700)
                        .setFooter({ text: `ページ ${page}/${totalPages} | 総ユーザー数: ${totalCount} | ${formatJSTDate()} JST` });
                    
                    const row = new ActionRowBuilder();
                    if (page > 1) {
                        row.addComponents(
                            new ButtonBuilder()
                                .setCustomId(`ranking_${guildId}_${page - 1}`)
                                .setLabel('前のページ')
                                .setStyle(ButtonStyle.Primary)
                        );
                    }
                    if (page < totalPages) {
                        row.addComponents(
                            new ButtonBuilder()
                                .setCustomId(`ranking_${guildId}_${page + 1}`)
                                .setLabel('次のページ')
                                .setStyle(ButtonStyle.Primary)
                        );
                    }
                    
                    const reply = { embeds: [embed] };
                    if (row.components.length > 0) {
                        reply.components = [row];
                    }
                    
                    interaction.editReply(reply);
                });
            });
        }
        
    } catch (error) {
        console.error('ボタンインタラクションエラー:', error);
        
        try {
            if (interaction.deferred) {
                await interaction.editReply({
                    content: 'エラーが発生しました。最新のランキングを表示してください。',
                    embeds: [],
                    components: []
                });
            }
        } catch (replyError) {
            console.error('ボタンエラー応答失敗:', replyError);
        }
    }
}

// ボット準備完了時の処理
client.once(Events.ClientReady, async () => {
    console.log(`${client.user.tag} がログインしました！`);
    console.log(`日本時間: ${formatJSTDate()}`);
    
    // スラッシュコマンドを登録
    await registerCommands();
    
    // 全ギルドのAFKチャンネルキャッシュを初期化
    client.guilds.cache.forEach(guild => {
        updateAFKChannelCache(guild.id);
    });
    
    console.log('Botの準備が完了しました！');
});

// プロセス終了時のクリーンアップ
process.on('SIGINT', () => {
    console.log('\nBotをシャットダウンしています...');
    db.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\nBotをシャットダウンしています...');
    db.close();
    process.exit(0);
});

client.login(token);
