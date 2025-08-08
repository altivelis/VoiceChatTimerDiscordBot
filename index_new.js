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

// スラッシュコマンド登録関数
async function registerCommands() {
    const commands = [
        new SlashCommandBuilder()
            .setName('role-reward')
            .setDescription('ロール報酬設定を管理します')
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
                    .setRequired(true)),
        
        new SlashCommandBuilder()
            .setName('schedule-reset')
            .setDescription('このサーバーのスケジュールリセットを管理します')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('add')
                    .setDescription('スケジュールリセットを追加（日本時間）')
                    .addStringOption(option =>
                        option.setName('datetime')
                            .setDescription('実行日時 (YYYY-MM-DD HH:MM形式、日本時間)')
                            .setRequired(true))
                    .addStringOption(option =>
                        option.setName('recurring')
                            .setDescription('繰り返し設定')
                            .setRequired(false)
                            .addChoices(
                                { name: '繰り返しなし', value: 'none' },
                                { name: '毎日', value: 'daily' },
                                { name: '毎週', value: 'weekly' },
                                { name: '毎月', value: 'monthly' }
                            )))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('list')
                    .setDescription('このサーバーのスケジュールリセット一覧を表示'))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('cancel')
                    .setDescription('スケジュールリセットをキャンセル')
                    .addStringOption(option =>
                        option.setName('id')
                            .setDescription('スケジュールID')
                            .setRequired(true)))
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
        
        // AFKチャンネルかどうかをチェックする関数
        const isAfkChannel = (channelId) => {
            if (!channelId) return false;
            const afkChannels = db.getAFKChannels(guildId);
            return afkChannels.includes(channelId) || 
                   newState.guild.afkChannel?.id === channelId ||
                   oldState.guild.afkChannel?.id === channelId;
        };
        
        // ボイスチャンネル入室
        if (oldState.channelId == null && newState.channelId != null) {
            console.log(`${newState.member.displayName}が${newState.channel.name}に接続しました (${newState.guild.name})`);

            // AFKチャンネル以外なら時間計測開始
            if (!isAfkChannel(newState.channelId)) {
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
            if (userSessions.has(sessionKey) && !isAfkChannel(oldState.channelId)) {
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
            if (userSessions.has(sessionKey) && !isAfkChannel(oldState.channelId) && isAfkChannel(newState.channelId)) {
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
            else if (isAfkChannel(oldState.channelId) && !isAfkChannel(newState.channelId)) {
                userSessions.set(sessionKey, {
                    startTime: currentTime,
                    channelId: newState.channelId,
                    guildId: guildId
                });
            }
            // 通常チャンネル間の移動の場合はチャンネルIDを更新
            else if (userSessions.has(sessionKey) && !isAfkChannel(oldState.channelId) && !isAfkChannel(newState.channelId)) {
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
    const voiceData = db.getVoiceTime(guildId, userId);
    
    if (!voiceData) return;
    
    const totalHours = voiceData.total_time / (1000 * 60 * 60);
    const member = guild.members.cache.get(userId);
    if (!member) return;
    
    const roleRewards = db.getRoleRewards(guildId);
    
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
        case 'schedule-reset':
            await handleScheduleResetCommand(interaction, guildId);
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
            
            try {
                db.addRoleReward(guildId, hours, role.id, role.name);
                await interaction.reply(`✅ ${hours}時間で${role.name}ロールの報酬を追加しました。`);
            } catch (error) {
                if (error.message.includes('UNIQUE constraint failed')) {
                    await interaction.reply({ content: `${hours}時間の設定は既に存在します。`, ephemeral: true });
                } else {
                    throw error;
                }
            }
            break;

        case 'remove':
            const removeHours = interaction.options.getInteger('hours');
            const result = db.removeRoleReward(guildId, removeHours);
            
            if (result.changes === 0) {
                await interaction.reply({ content: `${removeHours}時間の設定が見つかりません。`, ephemeral: true });
            } else {
                await interaction.reply(`✅ ${removeHours}時間のロール報酬を削除しました。`);
            }
            break;

        case 'list':
            const roleRewards = db.getRoleRewards(guildId);
            
            if (roleRewards.length === 0) {
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
            break;
    }
}

// AFKチャンネルコマンド処理
async function handleAfkChannelCommand(interaction, guildId) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
        case 'add':
            const channel = interaction.options.getChannel('channel');
            
            try {
                db.addAFKChannel(guildId, channel.id);
                await interaction.reply(`✅ ${channel.name}をAFKチャンネルに追加しました。`);
            } catch (error) {
                await interaction.reply({ content: `${channel.name}は既にAFKチャンネルに設定されています。`, ephemeral: true });
            }
            break;

        case 'remove':
            const removeChannel = interaction.options.getChannel('channel');
            const result = db.removeAFKChannel(guildId, removeChannel.id);
            
            if (result.changes === 0) {
                await interaction.reply({ content: `${removeChannel.name}はAFKチャンネルに設定されていません。`, ephemeral: true });
            } else {
                await interaction.reply(`✅ ${removeChannel.name}をAFKチャンネルから削除しました。`);
            }
            break;

        case 'list':
            const afkChannels = db.getAFKChannels(guildId);
            
            if (afkChannels.length === 0) {
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
            break;
    }
}

// ランキングコマンド処理
async function handleRankingCommand(interaction, guildId) {
    const page = interaction.options.getInteger('page') || 1;
    const itemsPerPage = 10;
    const offset = (page - 1) * itemsPerPage;
    
    // ランキングデータを取得
    const rankings = db.getGuildRanking(guildId, itemsPerPage, offset);
    const totalCount = db.getGuildRankingCount(guildId);
    
    if (totalCount === 0) {
        await interaction.reply('このサーバーにはまだ通話時間の記録がありません。');
        return;
    }
    
    const totalPages = Math.ceil(totalCount / itemsPerPage);
    if (page > totalPages) {
        await interaction.reply({ content: `ページ ${page} は存在しません。最大ページ数: ${totalPages}`, ephemeral: true });
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
}

// 個人時間コマンド処理
async function handleMyTimeCommand(interaction, guildId) {
    const userId = interaction.user.id;
    const voiceData = db.getVoiceTime(guildId, userId);
    
    if (!voiceData || voiceData.total_time === 0) {
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
    const roleRewards = db.getRoleRewards(guildId);
    const nextReward = roleRewards.find(r => totalHours < r.hours);
    const nextRewardText = nextReward 
        ? `\n\n**次のロール報酬:** ${nextReward.role_name} (あと${formatTime((nextReward.hours * 60 * 60 * 1000) - totalTime)})`
        : '\n\n🎉 すべてのロール報酬を獲得済みです！';
    
    const embed = new EmbedBuilder()
        .setTitle(`📊 ${interaction.guild.name} でのあなたの通話時間`)
        .setDescription(`**総通話時間:** ${formatTime(totalTime)}${currentSessionTime > 0 ? `\n**現在のセッション:** ${formatTime(currentSessionTime)}` : ''}${nextRewardText}`)
        .setColor(0x00AE86)
        .setFooter({ text: `${formatJSTDate()} JST` });
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
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
        // リセット前ランキングを表示
        await displayPreResetRanking(interaction.guild, 'manual', interaction.channel);
        
        // このサーバーのロール報酬を取得
        const roleRewards = db.getRoleRewards(guildId);
        const guildRanking = db.getGuildRanking(guildId, 1000); // 全ユーザー取得
        
        // ロール削除
        let removedRolesCount = 0;
        let processedUsers = 0;
        
        for (const ranking of guildRanking) {
            try {
                const member = interaction.guild.members.cache.get(ranking.user_id);
                if (member) {
                    for (const reward of roleRewards) {
                        const role = interaction.guild.roles.cache.get(reward.role_id);
                        if (role && member.roles.cache.has(reward.role_id)) {
                            await member.roles.remove(role);
                            removedRolesCount++;
                            console.log(`${member.displayName}から${role.name}ロールを削除しました`);
                        }
                    }
                }
                processedUsers++;
            } catch (error) {
                console.error(`ユーザー ${ranking.user_id} のロール削除エラー:`, error);
            }
        }
        
        // データをリセット
        db.resetGuildData(guildId);
        
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
        
        await interaction.editReply(`✅ ${interaction.guild.name} の通話時間リセットが完了しました。\n📊 処理したユーザー数: ${processedUsers}\n🎭 削除したロール数: ${removedRolesCount}`);
        
    } catch (error) {
        console.error('リセット処理エラー:', error);
        await interaction.editReply('❌ リセット処理中にエラーが発生しました。');
    }
}

// リセット前ランキング表示関数
async function displayPreResetRanking(guild, resetType = 'manual', targetChannel = null) {
    try {
        const guildId = guild.id;
        const rankings = db.getGuildRanking(guildId, 10); // 上位10位
        
        if (rankings.length === 0) {
            console.log('ランキングデータが空のため、リセット前ランキングの表示をスキップしました');
            return;
        }
        
        // 投稿先チャンネルを決定
        let channel = targetChannel;
        if (!channel) {
            const rankingSettings = db.getRankingSettings(guildId);
            if (rankingSettings.channel_id) {
                channel = guild.channels.cache.get(rankingSettings.channel_id);
            }
            
            if (!channel) {
                channel = guild.channels.cache.find(ch => 
                    ch.name.includes('管理') || ch.name.includes('log') || ch.name.includes('通知')
                ) || guild.systemChannel;
            }
        }
        
        if (!channel) {
            console.log('ランキング投稿先チャンネルが見つかりませんでした');
            return;
        }
        
        // 現在のセッション時間も含めて計算
        const enrichedRankings = rankings.map(ranking => {
            const sessionKey = `${guildId}_${ranking.user_id}`;
            let totalTime = ranking.total_time;
            
            if (userSessions.has(sessionKey)) {
                const session = userSessions.get(sessionKey);
                totalTime += Date.now() - session.startTime;
            }
            
            const member = guild.members.cache.get(ranking.user_id);
            return {
                userId: ranking.user_id,
                displayName: member?.displayName || '不明なユーザー',
                totalTime: totalTime
            };
        });
        
        // 再ソート
        enrichedRankings.sort((a, b) => b.totalTime - a.totalTime);
        
        // 統計情報を計算
        const totalUsers = db.getGuildRankingCount(guildId);
        const totalTime = enrichedRankings.reduce((sum, user) => sum + user.totalTime, 0);
        
        const description = enrichedRankings
            .map((user, index) => {
                const rank = index + 1;
                let rankEmoji = '';
                if (rank === 1) rankEmoji = '🥇';
                else if (rank === 2) rankEmoji = '🥈';
                else if (rank === 3) rankEmoji = '🥉';
                else rankEmoji = '   ';
                
                return `${rankEmoji} **${rank}位** ${user.displayName} - ${formatTime(user.totalTime)}`;
            })
            .join('\n');
        
        const resetTypeText = resetType === 'manual' ? '手動リセット' : 'スケジュールリセット';
        
        const embed = new EmbedBuilder()
            .setTitle(`🏆 【${guild.name} リセット前最終ランキング】`)
            .setDescription(`📅 **リセット日時:** ${formatJSTDate()}\n🔄 **実行方法:** ${resetTypeText}\n\n${description}`)
            .addFields(
                { name: '📊 統計情報', value: `**総参加者数:** ${totalUsers}人\n**総通話時間:** ${formatTime(totalTime)}`, inline: false }
            )
            .setColor(0xFFD700)
            .setThumbnail(guild.iconURL())
            .setTimestamp()
            .setFooter({ text: `${guild.name} | 通話時間記録 | JST`, iconURL: guild.iconURL() });
        
        await channel.send({ embeds: [embed] });
        console.log(`リセット前ランキングを ${channel.name} に投稿しました (${guild.name})`);
        
    } catch (error) {
        console.error('リセット前ランキング表示エラー:', error);
    }
}

// スケジュールリセットコマンド処理
async function handleScheduleResetCommand(interaction, guildId) {
    const subcommand = interaction.options.getSubcommand();

    // 管理者権限チェック
    if (!interaction.member.permissions.has('ADMINISTRATOR')) {
        await interaction.reply({ content: '❌ このコマンドを使用するには管理者権限が必要です。', ephemeral: true });
        return;
    }

    switch (subcommand) {
        case 'add':
            await handleScheduleAdd(interaction, guildId);
            break;
        case 'list':
            await handleScheduleList(interaction, guildId);
            break;
        case 'cancel':
            await handleScheduleCancel(interaction, guildId);
            break;
    }
}

// スケジュール追加処理
async function handleScheduleAdd(interaction, guildId) {
    const datetimeStr = interaction.options.getString('datetime');
    const recurring = interaction.options.getString('recurring') || 'none';

    if (!isValidJSTDateTime(datetimeStr)) {
        await interaction.reply({ 
            content: '❌ 日時の形式が正しくないか、過去の日時が指定されています。\nYYYY-MM-DD HH:MM形式で未来の日時を入力してください。\n例: 2025-08-09 02:00 (日本時間)', 
            ephemeral: true 
        });
        return;
    }

    try {
        const scheduledTimestamp = parseJSTDateTime(datetimeStr);
        const scheduleId = `reset_${scheduledTimestamp}_${Date.now()}`;
        
        const scheduleData = {
            id: scheduleId,
            guildId: guildId,
            originalDatetime: datetimeStr,
            nextExecution: scheduledTimestamp,
            recurring: recurring,
            createdBy: interaction.user.id,
            active: true,
            executionCount: 0
        };

        db.addScheduledReset(scheduleData);
        
        // タイマーを設定
        setupScheduleTimer(scheduleData, interaction.guild);

        const recurringText = recurring === 'none' ? '繰り返しなし' : 
                             recurring === 'daily' ? '毎日' :
                             recurring === 'weekly' ? '毎週' :
                             recurring === 'monthly' ? '毎月' : recurring;

        const embed = new EmbedBuilder()
            .setTitle('⏰ スケジュールリセットを追加しました')
            .addFields(
                { name: 'スケジュールID', value: scheduleId, inline: false },
                { name: '実行日時（日本時間）', value: datetimeStr, inline: true },
                { name: '繰り返し', value: recurringText, inline: true },
                { name: '次回実行', value: toDiscordTimestamp(scheduledTimestamp), inline: false }
            )
            .setColor(0x00AE86)
            .setTimestamp();

        await interaction.reply({ embeds: [embed] });
    } catch (error) {
        console.error('スケジュール追加エラー:', error);
        await interaction.reply({ content: 'スケジュール追加中にエラーが発生しました。', ephemeral: true });
    }
}

// スケジュール一覧表示
async function handleScheduleList(interaction, guildId) {
    const schedules = db.getScheduledResets(guildId, true);
    
    if (schedules.length === 0) {
        await interaction.reply('このサーバーにはスケジュールされたリセットはありません。');
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle(`📅 ${interaction.guild.name} のスケジュールリセット一覧`)
        .setColor(0x00AE86);

    schedules.forEach((schedule, index) => {
        const recurringText = schedule.recurring === 'none' ? '繰り返しなし' : 
                             schedule.recurring === 'daily' ? '毎日' :
                             schedule.recurring === 'weekly' ? '毎週' :
                             schedule.recurring === 'monthly' ? '毎月' : schedule.recurring;

        embed.addFields({
            name: `${index + 1}. ${schedule.id}`,
            value: `**日時:** ${schedule.original_datetime} (JST)\n**繰り返し:** ${recurringText}\n**次回実行:** ${toDiscordTimestamp(schedule.next_execution)}\n**実行回数:** ${schedule.execution_count}回`,
            inline: false
        });
    });

    await interaction.reply({ embeds: [embed] });
}

// スケジュールキャンセル
async function handleScheduleCancel(interaction, guildId) {
    const scheduleId = interaction.options.getString('id');
    const schedules = db.getScheduledResets(guildId, true);
    const schedule = schedules.find(s => s.id === scheduleId);
    
    if (!schedule) {
        await interaction.reply({ content: '❌ 指定されたスケジュールIDが見つかりません。', ephemeral: true });
        return;
    }

    // データベースで無効化
    db.deleteScheduledReset(scheduleId);
    
    // タイマーをクリア
    if (activeTimers.has(scheduleId)) {
        clearTimeout(activeTimers.get(scheduleId));
        activeTimers.delete(scheduleId);
    }

    await interaction.reply(`✅ スケジュール \`${scheduleId}\` をキャンセルしました。`);
}

// スケジュールタイマー設定
function setupScheduleTimer(schedule, guild) {
    const now = Date.now();
    const delay = schedule.nextExecution - now;

    if (delay <= 0) {
        executeScheduledReset(schedule, guild);
        return;
    }

    const timerId = setTimeout(() => {
        executeScheduledReset(schedule, guild);
    }, delay);

    activeTimers.set(schedule.id, timerId);
    console.log(`スケジュール ${schedule.id} のタイマーを設定しました (${delay}ms後に実行)`);
}

// スケジュールリセット実行
async function executeScheduledReset(schedule, guild) {
    try {
        console.log(`スケジュールリセットを実行中: ${schedule.id} (${guild.name})`);
        
        const guildId = guild.id;
        
        // 管理チャンネル通知
        const notificationChannel = guild.channels.cache.find(channel => 
            channel.name.includes('管理') || channel.name.includes('log') || channel.name.includes('通知')
        ) || guild.systemChannel;

        if (notificationChannel) {
            const embed = new EmbedBuilder()
                .setTitle('🔄 スケジュールリセット実行中')
                .setDescription(`スケジュール \`${schedule.id}\` による自動リセットを実行しています...\n**日本時間:** ${formatJSTDate()}`)
                .setColor(0xFF6B6B)
                .setTimestamp();
            
            await notificationChannel.send({ embeds: [embed] });
        }

        // リセット前ランキングを表示
        await displayPreResetRanking(guild, 'scheduled');

        // リセット実行
        const roleRewards = db.getRoleRewards(guildId);
        const guildRanking = db.getGuildRanking(guildId, 1000);
        
        let removedRolesCount = 0;
        let processedUsers = 0;
        
        for (const ranking of guildRanking) {
            try {
                const member = guild.members.cache.get(ranking.user_id);
                if (member) {
                    for (const reward of roleRewards) {
                        const role = guild.roles.cache.get(reward.role_id);
                        if (role && member.roles.cache.has(reward.role_id)) {
                            await member.roles.remove(role);
                            removedRolesCount++;
                        }
                    }
                }
                processedUsers++;
            } catch (error) {
                console.error(`ユーザー ${ranking.user_id} のロール削除エラー:`, error);
            }
        }
        
        // データリセット
        db.resetGuildData(guildId);
        
        // 現在のセッションをリセット
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

        // 実行回数更新
        const updatedSchedule = { ...schedule, execution_count: schedule.execution_count + 1 };

        // 次回実行日時を計算（定期実行の場合）
        if (schedule.recurring !== 'none') {
            calculateNextExecution(updatedSchedule);
            db.updateScheduledReset(schedule.id, {
                next_execution: updatedSchedule.nextExecution,
                execution_count: updatedSchedule.execution_count
            });
            setupScheduleTimer(updatedSchedule, guild);
        } else {
            db.deleteScheduledReset(schedule.id);
        }

        // 完了通知
        if (notificationChannel) {
            const completionEmbed = new EmbedBuilder()
                .setTitle('✅ スケジュールリセット完了')
                .setDescription(`スケジュール \`${schedule.id}\` によるリセットが完了しました。`)
                .addFields(
                    { name: '処理したユーザー数', value: `${processedUsers}人`, inline: true },
                    { name: '削除したロール数', value: `${removedRolesCount}個`, inline: true },
                    { name: '実行回数', value: `${updatedSchedule.execution_count}回目`, inline: true }
                )
                .setColor(0x00FF00)
                .setTimestamp();

            if (schedule.recurring !== 'none') {
                completionEmbed.addFields({
                    name: '次回実行予定',
                    value: toDiscordTimestamp(updatedSchedule.nextExecution),
                    inline: false
                });
            }
            
            await notificationChannel.send({ embeds: [completionEmbed] });
        }

        console.log(`スケジュールリセット完了: ${schedule.id} (${guild.name})`);
        
    } catch (error) {
        console.error(`スケジュールリセットエラー (${schedule.id}):`, error);
    }
}

// 次回実行日時計算
function calculateNextExecution(schedule) {
    const current = new Date(schedule.nextExecution + (9 * 60 * 60 * 1000)); // JSTに変換
    
    switch (schedule.recurring) {
        case 'daily':
            current.setDate(current.getDate() + 1);
            break;
        case 'weekly':
            current.setDate(current.getDate() + 7);
            break;
        case 'monthly':
            current.setMonth(current.getMonth() + 1);
            break;
    }
    
    schedule.nextExecution = current.getTime() - (9 * 60 * 60 * 1000); // UTCに戻す
}

// ボタンインタラクション処理（堅牢性向上）
async function handleButtonInteraction(interaction) {
    try {
        // 権限チェック
        if (!interaction.guild || !interaction.member) {
            return await interaction.reply({ 
                content: 'このボタンは無効になっています。最新のランキングを表示してください。', 
                ephemeral: true 
            });
        }

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
            
            // ランキングを再生成
            const itemsPerPage = 10;
            const offset = (page - 1) * itemsPerPage;
            const rankings = db.getGuildRanking(guildId, itemsPerPage, offset);
            const totalCount = db.getGuildRankingCount(guildId);
            
            if (rankings.length === 0) {
                return await interaction.editReply({
                    content: 'ランキングデータが見つかりません。',
                    embeds: [],
                    components: []
                });
            }
            
            const totalPages = Math.ceil(totalCount / itemsPerPage);
            
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
            
            await interaction.editReply(reply);
        }
        
    } catch (error) {
        console.error('ボタンインタラクションエラー:', error);
        
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ 
                    content: 'エラーが発生しました。最新のランキングを表示してください。', 
                    ephemeral: true 
                });
            } else if (interaction.deferred) {
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

// スケジュール復旧
function restoreSchedules() {
    console.log('スケジュールを復旧中...');
    
    try {
        // 全ギルドのアクティブなスケジュールを取得
        const allGuilds = client.guilds.cache;
        let restoredCount = 0;
        
        allGuilds.forEach(guild => {
            const schedules = db.getScheduledResets(guild.id, true);
            const now = Date.now();
            
            schedules.forEach(schedule => {
                if (schedule.next_execution > now) {
                    setupScheduleTimer(schedule, guild);
                    restoredCount++;
                }
            });
        });
        
        console.log(`${restoredCount}個のスケジュールを復旧しました`);
    } catch (error) {
        console.error('スケジュール復旧エラー:', error);
    }
}

// ボット準備完了時の処理
client.once(Events.ClientReady, async () => {
    console.log(`${client.user.tag} がログインしました！`);
    console.log(`日本時間: ${formatJSTDate()}`);
    
    // スラッシュコマンドを登録
    await registerCommands();
    
    // スケジュールを復旧
    setTimeout(() => {
        restoreSchedules();
    }, 3000);
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
