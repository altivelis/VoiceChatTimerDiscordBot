const { Client, GatewayIntentBits, Events, EmbedBuilder, SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, REST, Routes } = require('discord.js'); //discord.js からClientとIntentsを読み込む
const fs = require('fs');
const path = require('path');
const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildVoiceStates
    ]
  });  //clientインスタンスを作成する  
const {token,guildId} = require('./config.json');

// データファイル管理
const dataPath = './data.json';

// データを読み込む関数
function loadData() {
    try {
        if (fs.existsSync(dataPath)) {
            const data = fs.readFileSync(dataPath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('データ読み込みエラー:', error);
    }
    return {
        voiceTime: {},
        roleRewards: [],
        afkChannels: [],
        scheduledResets: []
    };
}

// データを保存する関数
function saveData(data) {
    try {
        fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('データ保存エラー:', error);
    }
}

// 時間をフォーマットする関数
function formatTime(milliseconds) {
    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}時間${minutes}分`;
}

// ユーザーのセッション管理
const userSessions = new Map();

client.once(Events.ClientReady, async () => {
    console.log("Ready!");
    
    // スラッシュコマンドを登録
    await registerCommands();
});

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
            .setDescription('AFKチャンネル設定を管理します')
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
            .setDescription('通話時間ランキングを表示')
            .addIntegerOption(option =>
                option.setName('page')
                    .setDescription('ページ番号（デフォルト: 1）')
                    .setMinValue(1)),
        
        new SlashCommandBuilder()
            .setName('my-time')
            .setDescription('自分の通話時間を表示'),
        
        new SlashCommandBuilder()
            .setName('reset-time')
            .setDescription('全ユーザーの通話時間をリセット')
            .addStringOption(option =>
                option.setName('confirm')
                    .setDescription('確認のため "confirm" と入力してください')
                    .setRequired(true)),
        
        new SlashCommandBuilder()
            .setName('schedule-reset')
            .setDescription('スケジュールされた通話時間リセットを管理します')
            .addSubcommand(subcommand =>
                subcommand
                    .setName('add')
                    .setDescription('スケジュールされたリセットを追加')
                    .addStringOption(option =>
                        option.setName('datetime')
                            .setDescription('実行日時 (YYYY-MM-DD HH:MM形式)')
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
                    .setDescription('スケジュールされたリセット一覧を表示'))
            .addSubcommand(subcommand =>
                subcommand
                    .setName('cancel')
                    .setDescription('スケジュールされたリセットをキャンセル')
                    .addStringOption(option =>
                        option.setName('id')
                            .setDescription('スケジュールID')
                            .setRequired(true)))
    ];

    const rest = new REST({ version: '10' }).setToken(token);

    try {
        console.log('スラッシュコマンドを登録中...');
        
        if (guildId) {
            // 特定のギルドに登録
            await rest.put(
                Routes.applicationGuildCommands(client.user.id, guildId),
                { body: commands }
            );
            console.log('ギルドコマンドを登録しました');
        } else {
            // グローバルに登録
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

client.on(Events.VoiceStateUpdate,(oldState, newState)=>{
    if(newState && oldState){
        const data = loadData();
        const userId = newState.member.id;
        const currentTime = Date.now();
        
        // AFKチャンネルかどうかをチェックする関数
        const isAfkChannel = (channelId) => {
            if (!channelId) return false;
            return data.afkChannels.includes(channelId) || 
                   newState.guild.afkChannel?.id === channelId ||
                   oldState.guild.afkChannel?.id === channelId;
        };
        
        //ボイスチャンネル入室
        if(oldState.channelId==null && newState.channelId!=null){
            console.log(`${newState.member.displayName}が${newState.channel.name}に接続しました`);

            // AFKチャンネル以外なら時間計測開始
            if (!isAfkChannel(newState.channelId)) {
                userSessions.set(userId, {
                    startTime: currentTime,
                    channelId: newState.channelId
                });
            }
        }
        
        //ボイスチャンネル退室
        if(oldState.channelId!=null && newState.channelId==null){
            console.log(`${oldState.member.displayName}が${oldState.channel.name}から切断しました`);
            
            // セッション終了処理
            if (userSessions.has(userId) && !isAfkChannel(oldState.channelId)) {
                const session = userSessions.get(userId);
                const sessionTime = currentTime - session.startTime;
                
                // データに累積時間を追加
                if (!data.voiceTime[userId]) {
                    data.voiceTime[userId] = { totalTime: 0, sessions: [] };
                }
                data.voiceTime[userId].totalTime += sessionTime;
                data.voiceTime[userId].sessions.push({
                    channelId: session.channelId,
                    startTime: session.startTime,
                    endTime: currentTime
                });
                
                saveData(data);
                userSessions.delete(userId);
                
                // ロール報酬チェック
                checkRoleRewards(newState.guild, userId, data);
            }
        }
        
        //ボイスチャンネル移動
        if(oldState.channelId!=null && newState.channelId!=null && oldState.channelId!=newState.channelId){
            console.log(`${oldState.member.displayName}が${oldState.channel.name}から${newState.channel.name}に移動しました`);
            
            // 移動先がAFKチャンネルの場合はセッション終了
            if (userSessions.has(userId) && !isAfkChannel(oldState.channelId) && isAfkChannel(newState.channelId)) {
                const session = userSessions.get(userId);
                const sessionTime = currentTime - session.startTime;
                
                if (!data.voiceTime[userId]) {
                    data.voiceTime[userId] = { totalTime: 0, sessions: [] };
                }
                data.voiceTime[userId].totalTime += sessionTime;
                data.voiceTime[userId].sessions.push({
                    channelId: session.channelId,
                    startTime: session.startTime,
                    endTime: currentTime
                });
                
                saveData(data);
                userSessions.delete(userId);
                
                checkRoleRewards(newState.guild, userId, data);
            }
            // AFKチャンネルから通常チャンネルに移動の場合はセッション開始
            else if (isAfkChannel(oldState.channelId) && !isAfkChannel(newState.channelId)) {
                userSessions.set(userId, {
                    startTime: currentTime,
                    channelId: newState.channelId
                });
            }
            // 通常チャンネル間の移動の場合はチャンネルIDを更新
            else if (userSessions.has(userId) && !isAfkChannel(oldState.channelId) && !isAfkChannel(newState.channelId)) {
                const session = userSessions.get(userId);
                session.channelId = newState.channelId;
                userSessions.set(userId, session);
            }
        }
    }
})

// ロール報酬チェック関数
async function checkRoleRewards(guild, userId, data) {
    if (!data.voiceTime[userId]) return;
    
    const totalHours = data.voiceTime[userId].totalTime / (1000 * 60 * 60);
    const member = guild.members.cache.get(userId);
    if (!member) return;
    
    for (const reward of data.roleRewards) {
        if (totalHours >= reward.hours) {
            const role = guild.roles.cache.get(reward.roleId);
            if (role && !member.roles.cache.has(reward.roleId)) {
                try {
                    // ロールを付与
                    await member.roles.add(role);
                    console.log(`${member.displayName}に${role.name}ロールを付与しました`);
                    
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
            .setFooter({ text: `${guild.name} | ボイスチャットタイマー`, iconURL: guild.iconURL() });

        await member.send({ embeds: [embed] });
        console.log(`${member.displayName}にロール報酬通知DMを送信しました`);
    } catch (error) {
        console.error(`DM送信エラー (${member.displayName}):`, error);
        // DMが送信できない場合はコンソールにログを出力するのみ
    }
}

// スラッシュコマンド処理
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
        const reply = { content: 'エラーが発生しました。', ephemeral: true };
        
        if (interaction.replied) {
            await interaction.followUp(reply);
        } else {
            await interaction.reply(reply);
        }
    }
});

// スラッシュコマンド処理関数
async function handleSlashCommand(interaction) {
    const { commandName, options } = interaction;
    const data = loadData();

    switch (commandName) {
        case 'role-reward':
            await handleRoleRewardCommand(interaction, data);
            break;
        case 'afk-channel':
            await handleAfkChannelCommand(interaction, data);
            break;
        case 'ranking':
            await handleRankingCommand(interaction, data);
            break;
        case 'my-time':
            await handleMyTimeCommand(interaction, data);
            break;
        case 'reset-time':
            await handleResetTimeCommand(interaction, data);
            break;
        case 'schedule-reset':
            await handleScheduleResetCommand(interaction, data);
            break;
    }
}

// ロール報酬コマンド処理
async function handleRoleRewardCommand(interaction, data) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
        case 'add':
            const hours = interaction.options.getInteger('hours');
            const role = interaction.options.getRole('role');
            
            // 既存の設定をチェック
            const existingReward = data.roleRewards.find(r => r.hours === hours);
            if (existingReward) {
                await interaction.reply({ content: `${hours}時間の設定は既に存在します。`, ephemeral: true });
                return;
            }
            
            data.roleRewards.push({
                hours: hours,
                roleId: role.id,
                roleName: role.name
            });
            
            // 時間順にソート
            data.roleRewards.sort((a, b) => a.hours - b.hours);
            saveData(data);
            
            await interaction.reply(`✅ ${hours}時間で${role.name}ロールの報酬を追加しました。`);
            break;

        case 'remove':
            const removeHours = interaction.options.getInteger('hours');
            const index = data.roleRewards.findIndex(r => r.hours === removeHours);
            
            if (index === -1) {
                await interaction.reply({ content: `${removeHours}時間の設定が見つかりません。`, ephemeral: true });
                return;
            }
            
            const removed = data.roleRewards.splice(index, 1)[0];
            saveData(data);
            
            await interaction.reply(`✅ ${removeHours}時間の${removed.roleName}ロール報酬を削除しました。`);
            break;

        case 'list':
            if (data.roleRewards.length === 0) {
                await interaction.reply('ロール報酬が設定されていません。');
                return;
            }
            
            const embed = new EmbedBuilder()
                .setTitle('ロール報酬設定一覧')
                .setColor(0x00AE86)
                .setDescription(
                    data.roleRewards
                        .map(r => `**${r.hours}時間** → ${r.roleName}`)
                        .join('\n')
                );
            
            await interaction.reply({ embeds: [embed] });
            break;
    }
}

// AFKチャンネルコマンド処理
async function handleAfkChannelCommand(interaction, data) {
    const subcommand = interaction.options.getSubcommand();

    switch (subcommand) {
        case 'add':
            const channel = interaction.options.getChannel('channel');
            
            if (data.afkChannels.includes(channel.id)) {
                await interaction.reply({ content: `${channel.name}は既にAFKチャンネルに設定されています。`, ephemeral: true });
                return;
            }
            
            data.afkChannels.push(channel.id);
            saveData(data);
            
            await interaction.reply(`✅ ${channel.name}をAFKチャンネルに追加しました。`);
            break;

        case 'remove':
            const removeChannel = interaction.options.getChannel('channel');
            const channelIndex = data.afkChannels.indexOf(removeChannel.id);
            
            if (channelIndex === -1) {
                await interaction.reply({ content: `${removeChannel.name}はAFKチャンネルに設定されていません。`, ephemeral: true });
                return;
            }
            
            data.afkChannels.splice(channelIndex, 1);
            saveData(data);
            
            await interaction.reply(`✅ ${removeChannel.name}をAFKチャンネルから削除しました。`);
            break;

        case 'list':
            if (data.afkChannels.length === 0) {
                await interaction.reply('AFKチャンネルが設定されていません。');
                return;
            }
            
            const channelNames = data.afkChannels
                .map(id => interaction.guild.channels.cache.get(id)?.name || '不明なチャンネル')
                .join('\n');
            
            const embed = new EmbedBuilder()
                .setTitle('AFKチャンネル一覧')
                .setColor(0x00AE86)
                .setDescription(channelNames);
            
            await interaction.reply({ embeds: [embed] });
            break;
    }
}

// ランキングコマンド処理
async function handleRankingCommand(interaction, data) {
    const page = interaction.options.getInteger('page') || 1;
    const itemsPerPage = 10;
    
    // ランキングデータを作成
    const rankings = [];
    for (const [userId, userData] of Object.entries(data.voiceTime)) {
        const member = interaction.guild.members.cache.get(userId);
        if (member && userData.totalTime > 0) {
            rankings.push({
                userId,
                displayName: member.displayName,
                totalTime: userData.totalTime
            });
        }
    }
    
    // 時間順にソート
    rankings.sort((a, b) => b.totalTime - a.totalTime);
    
    if (rankings.length === 0) {
        await interaction.reply('まだ通話時間の記録がありません。');
        return;
    }
    
    const totalPages = Math.ceil(rankings.length / itemsPerPage);
    if (page > totalPages) {
        await interaction.reply({ content: `ページ ${page} は存在しません。最大ページ数: ${totalPages}`, ephemeral: true });
        return;
    }
    
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const pageRankings = rankings.slice(startIndex, endIndex);
    
    const description = pageRankings
        .map((user, index) => {
            const rank = startIndex + index + 1;
            return `**${rank}位** ${user.displayName} - ${formatTime(user.totalTime)}`;
        })
        .join('\n');
    
    const embed = new EmbedBuilder()
        .setTitle('🏆 通話時間ランキング')
        .setDescription(description)
        .setColor(0xFFD700)
        .setFooter({ text: `ページ ${page}/${totalPages} | 総ユーザー数: ${rankings.length}` });
    
    // ページネーションボタン
    const row = new ActionRowBuilder();
    if (page > 1) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`ranking_${page - 1}`)
                .setLabel('前のページ')
                .setStyle(ButtonStyle.Primary)
        );
    }
    if (page < totalPages) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`ranking_${page + 1}`)
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
async function handleMyTimeCommand(interaction, data) {
    const userId = interaction.user.id;
    const userData = data.voiceTime[userId];
    
    if (!userData || userData.totalTime === 0) {
        await interaction.reply({ content: 'まだ通話時間の記録がありません。', ephemeral: true });
        return;
    }
    
    // 現在のセッション時間を加算
    let currentSessionTime = 0;
    if (userSessions.has(userId)) {
        const session = userSessions.get(userId);
        currentSessionTime = Date.now() - session.startTime;
    }
    
    const totalTime = userData.totalTime + currentSessionTime;
    const totalHours = totalTime / (1000 * 60 * 60);
    
    // 次のロール報酬を取得
    const nextReward = data.roleRewards.find(r => totalHours < r.hours);
    const nextRewardText = nextReward 
        ? `\n\n**次のロール報酬:** ${nextReward.roleName} (あと${formatTime((nextReward.hours * 60 * 60 * 1000) - totalTime)})`
        : '\n\n🎉 すべてのロール報酬を獲得済みです！';
    
    const embed = new EmbedBuilder()
        .setTitle('📊 あなたの通話時間')
        .setDescription(`**総通話時間:** ${formatTime(totalTime)}${currentSessionTime > 0 ? `\n**現在のセッション:** ${formatTime(currentSessionTime)}` : ''}${nextRewardText}`)
        .setColor(0x00AE86)
        .setFooter({ text: `セッション数: ${userData.sessions.length}` });
    
    await interaction.reply({ embeds: [embed], ephemeral: true });
}

// リセットコマンド処理
async function handleResetTimeCommand(interaction, data) {
    const confirm = interaction.options.getString('confirm');
    
    if (confirm !== 'confirm') {
        await interaction.reply({ content: 'リセットを実行するには "confirm" と入力してください。', ephemeral: true });
        return;
    }
    
    // 進行状況を表示
    await interaction.reply('⏳ 通話時間をリセット中...');
    
    try {
        // すべてのユーザーからロール報酬を削除
        let removedRolesCount = 0;
        let processedUsers = 0;
        
        for (const [userId, userData] of Object.entries(data.voiceTime)) {
            try {
                const member = interaction.guild.members.cache.get(userId);
                if (member) {
                    // このユーザーから報酬ロールを削除
                    for (const reward of data.roleRewards) {
                        const role = interaction.guild.roles.cache.get(reward.roleId);
                        if (role && member.roles.cache.has(reward.roleId)) {
                            await member.roles.remove(role);
                            removedRolesCount++;
                            console.log(`${member.displayName}から${role.name}ロールを削除しました`);
                        }
                    }
                }
                processedUsers++;
            } catch (error) {
                console.error(`ユーザー ${userId} のロール削除エラー:`, error);
            }
        }
        
        // データをリセット
        data.voiceTime = {};
        
        // 現在ボイスチャットに参加しているユーザーのセッションをリセット
        const currentTime = Date.now();
        for (const [userId, session] of userSessions.entries()) {
            // 現在時刻から新しいセッションを開始
            userSessions.set(userId, {
                startTime: currentTime,
                channelId: session.channelId
            });
        }
        
        saveData(data);
        
        await interaction.editReply(`✅ 通話時間リセットが完了しました。\n📊 処理したユーザー数: ${processedUsers}\n🎭 削除したロール数: ${removedRolesCount}`);
        
    } catch (error) {
        console.error('リセット処理エラー:', error);
        await interaction.editReply('❌ リセット処理中にエラーが発生しました。');
    }
}

// ボタンインタラクション処理
async function handleButtonInteraction(interaction) {
    if (interaction.customId.startsWith('ranking_')) {
        const page = parseInt(interaction.customId.split('_')[1]);
        const data = loadData();
        
        // ランキングを再生成してページを更新
        await interaction.deferUpdate();
        
        const itemsPerPage = 10;
        const rankings = [];
        for (const [userId, userData] of Object.entries(data.voiceTime)) {
            const member = interaction.guild.members.cache.get(userId);
            if (member && userData.totalTime > 0) {
                rankings.push({
                    userId,
                    displayName: member.displayName,
                    totalTime: userData.totalTime
                });
            }
        }
        
        rankings.sort((a, b) => b.totalTime - a.totalTime);
        
        const totalPages = Math.ceil(rankings.length / itemsPerPage);
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const pageRankings = rankings.slice(startIndex, endIndex);
        
        const description = pageRankings
            .map((user, index) => {
                const rank = startIndex + index + 1;
                return `**${rank}位** ${user.displayName} - ${formatTime(user.totalTime)}`;
            })
            .join('\n');
        
        const embed = new EmbedBuilder()
            .setTitle('🏆 通話時間ランキング')
            .setDescription(description)
            .setColor(0xFFD700)
            .setFooter({ text: `ページ ${page}/${totalPages} | 総ユーザー数: ${rankings.length}` });
        
        const row = new ActionRowBuilder();
        if (page > 1) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`ranking_${page - 1}`)
                    .setLabel('前のページ')
                    .setStyle(ButtonStyle.Primary)
            );
        }
        if (page < totalPages) {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`ranking_${page + 1}`)
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
}

// スケジュールリセットコマンド処理
async function handleScheduleResetCommand(interaction, data) {
    const subcommand = interaction.options.getSubcommand();

    // 管理者権限チェック
    if (!interaction.member.permissions.has('ADMINISTRATOR')) {
        await interaction.reply({ content: '❌ このコマンドを使用するには管理者権限が必要です。', ephemeral: true });
        return;
    }

    switch (subcommand) {
        case 'add':
            await handleScheduleAdd(interaction, data);
            break;
        case 'list':
            await handleScheduleList(interaction, data);
            break;
        case 'cancel':
            await handleScheduleCancel(interaction, data);
            break;
    }
}

// スケジュール追加処理
async function handleScheduleAdd(interaction, data) {
    const datetimeStr = interaction.options.getString('datetime');
    const recurring = interaction.options.getString('recurring') || 'none';

    // 日時フォーマットバリデーション
    const dateRegex = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;
    const match = datetimeStr.match(dateRegex);
    
    if (!match) {
        await interaction.reply({ 
            content: '❌ 日時の形式が正しくありません。YYYY-MM-DD HH:MM形式で入力してください。\n例: 2025-08-03 02:00', 
            ephemeral: true 
        });
        return;
    }

    // 日時パース
    const [, year, month, day, hour, minute] = match;
    const scheduledDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day), parseInt(hour), parseInt(minute));
    
    // 過去日時チェック
    if (scheduledDate <= new Date()) {
        await interaction.reply({ 
            content: '❌ 過去の日時は指定できません。未来の日時を指定してください。', 
            ephemeral: true 
        });
        return;
    }

    // スケジュールID生成
    const scheduleId = `reset_${scheduledDate.getTime()}_${Date.now()}`;
    
    // スケジュールデータ作成
    const schedule = {
        id: scheduleId,
        originalDatetime: datetimeStr,
        nextExecution: scheduledDate.getTime(),
        recurring: recurring,
        createdBy: interaction.user.id,
        guildId: interaction.guild.id,
        createdAt: Date.now(),
        active: true,
        executionCount: 0
    };

    data.scheduledResets.push(schedule);
    saveData(data);

    // タイマーを設定
    setupScheduleTimer(schedule, interaction.guild);

    const recurringText = recurring === 'none' ? '繰り返しなし' : 
                         recurring === 'daily' ? '毎日' :
                         recurring === 'weekly' ? '毎週' :
                         recurring === 'monthly' ? '毎月' : recurring;

    const embed = new EmbedBuilder()
        .setTitle('⏰ スケジュールリセットを追加しました')
        .addFields(
            { name: 'スケジュールID', value: scheduleId, inline: false },
            { name: '実行日時', value: datetimeStr, inline: true },
            { name: '繰り返し', value: recurringText, inline: true },
            { name: '次回実行', value: `<t:${Math.floor(scheduledDate.getTime() / 1000)}:F>`, inline: false }
        )
        .setColor(0x00AE86)
        .setTimestamp();

    await interaction.reply({ embeds: [embed] });
}

// スケジュール一覧表示
async function handleScheduleList(interaction, data) {
    const guildSchedules = data.scheduledResets.filter(s => s.guildId === interaction.guild.id && s.active);
    
    if (guildSchedules.length === 0) {
        await interaction.reply('📋 スケジュールされたリセットはありません。');
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle('📅 スケジュールされたリセット一覧')
        .setColor(0x00AE86);

    guildSchedules.forEach((schedule, index) => {
        const recurringText = schedule.recurring === 'none' ? '繰り返しなし' : 
                             schedule.recurring === 'daily' ? '毎日' :
                             schedule.recurring === 'weekly' ? '毎週' :
                             schedule.recurring === 'monthly' ? '毎月' : schedule.recurring;

        embed.addFields({
            name: `${index + 1}. ${schedule.id}`,
            value: `**日時:** ${schedule.originalDatetime}\n**繰り返し:** ${recurringText}\n**次回実行:** <t:${Math.floor(schedule.nextExecution / 1000)}:F>\n**実行回数:** ${schedule.executionCount}回`,
            inline: false
        });
    });

    await interaction.reply({ embeds: [embed] });
}

// スケジュールキャンセル
async function handleScheduleCancel(interaction, data) {
    const scheduleId = interaction.options.getString('id');
    const scheduleIndex = data.scheduledResets.findIndex(s => s.id === scheduleId && s.guildId === interaction.guild.id);
    
    if (scheduleIndex === -1) {
        await interaction.reply({ content: '❌ 指定されたスケジュールIDが見つかりません。', ephemeral: true });
        return;
    }

    const schedule = data.scheduledResets[scheduleIndex];
    schedule.active = false;
    
    // タイマーをクリア
    if (activeTimers.has(scheduleId)) {
        clearTimeout(activeTimers.get(scheduleId));
        activeTimers.delete(scheduleId);
    }

    saveData(data);

    await interaction.reply(`✅ スケジュール \`${scheduleId}\` をキャンセルしました。`);
}

// アクティブなタイマーを管理
const activeTimers = new Map();

// スケジュールタイマー設定
function setupScheduleTimer(schedule, guild) {
    const now = Date.now();
    const delay = schedule.nextExecution - now;

    if (delay <= 0) {
        // 即座に実行
        executeScheduledReset(schedule, guild);
        return;
    }

    const timerId = setTimeout(() => {
        executeScheduledReset(schedule, guild);
    }, delay);

    activeTimers.set(schedule.id, timerId);
    console.log(`スケジュール ${schedule.id} のタイマーを設定しました (${delay}ms後に実行)`);
}

// スケジュールされたリセット実行
async function executeScheduledReset(schedule, guild) {
    try {
        console.log(`スケジュールリセットを実行中: ${schedule.id}`);
        
        const data = loadData();
        
        // 管理チャンネル通知
        const notificationChannel = guild.channels.cache.find(channel => 
            channel.name.includes('管理') || channel.name.includes('log') || channel.name.includes('通知')
        ) || guild.systemChannel;

        if (notificationChannel) {
            const embed = new EmbedBuilder()
                .setTitle('🔄 スケジュールリセット実行中')
                .setDescription(`スケジュール \`${schedule.id}\` による自動リセットを実行しています...`)
                .setColor(0xFF6B6B)
                .setTimestamp();
            
            await notificationChannel.send({ embeds: [embed] });
        }

        // リセット実行（既存のリセット処理を流用）
        let removedRolesCount = 0;
        let processedUsers = 0;
        
        for (const [userId, userData] of Object.entries(data.voiceTime)) {
            try {
                const member = guild.members.cache.get(userId);
                if (member) {
                    for (const reward of data.roleRewards) {
                        const role = guild.roles.cache.get(reward.roleId);
                        if (role && member.roles.cache.has(reward.roleId)) {
                            await member.roles.remove(role);
                            removedRolesCount++;
                        }
                    }
                }
                processedUsers++;
            } catch (error) {
                console.error(`ユーザー ${userId} のロール削除エラー:`, error);
            }
        }
        
        // データリセット
        data.voiceTime = {};
        
        // 現在のセッションをリセット
        const currentTime = Date.now();
        for (const [userId, session] of userSessions.entries()) {
            userSessions.set(userId, {
                startTime: currentTime,
                channelId: session.channelId
            });
        }

        // 実行回数更新
        schedule.executionCount++;

        // 次回実行日時を計算（定期実行の場合）
        if (schedule.recurring !== 'none') {
            calculateNextExecution(schedule);
            setupScheduleTimer(schedule, guild);
        } else {
            schedule.active = false;
        }

        saveData(data);

        // 完了通知
        if (notificationChannel) {
            const completionEmbed = new EmbedBuilder()
                .setTitle('✅ スケジュールリセット完了')
                .setDescription(`スケジュール \`${schedule.id}\` によるリセットが完了しました。`)
                .addFields(
                    { name: '処理したユーザー数', value: `${processedUsers}人`, inline: true },
                    { name: '削除したロール数', value: `${removedRolesCount}個`, inline: true },
                    { name: '実行回数', value: `${schedule.executionCount}回目`, inline: true }
                )
                .setColor(0x00FF00)
                .setTimestamp();

            if (schedule.recurring !== 'none' && schedule.active) {
                completionEmbed.addFields({
                    name: '次回実行予定',
                    value: `<t:${Math.floor(schedule.nextExecution / 1000)}:F>`,
                    inline: false
                });
            }
            
            await notificationChannel.send({ embeds: [completionEmbed] });
        }

        console.log(`スケジュールリセット完了: ${schedule.id}`);
        
    } catch (error) {
        console.error(`スケジュールリセットエラー (${schedule.id}):`, error);
    }
}

// 次回実行日時計算
function calculateNextExecution(schedule) {
    const current = new Date(schedule.nextExecution);
    
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
    
    schedule.nextExecution = current.getTime();
}

// ボット起動時にスケジュールを復旧
function restoreSchedules() {
    const data = loadData();
    const now = Date.now();
    
    for (const schedule of data.scheduledResets) {
        if (schedule.active && schedule.nextExecution > now) {
            const guild = client.guilds.cache.get(schedule.guildId);
            if (guild) {
                setupScheduleTimer(schedule, guild);
            }
        }
    }
    
    console.log(`${data.scheduledResets.filter(s => s.active).length}個のスケジュールを復旧しました`);
}

// ボット準備完了時にスケジュール復旧を実行
client.once(Events.ClientReady, async () => {
    console.log("Ready!");
    
    // スラッシュコマンドを登録
    await registerCommands();
    
    // スケジュールを復旧
    setTimeout(() => {
        restoreSchedules();
    }, 3000); // 3秒後に実行（ギルドキャッシュの準備を待つ）
});

client.login(token);
