const VoiceTimerDB = require('./database.js');
const fs = require('fs');
const path = require('path');
const { formatJSTDate } = require('./utils.js');

// データ移行クラス
class DataMigration {
    constructor() {
        this.db = new VoiceTimerDB();
        this.jsonPath = './data.json';
        this.backupPath = `./data_backup_${Date.now()}.json`;
    }

    // JSONデータを読み込み
    loadJSONData() {
        try {
            if (fs.existsSync(this.jsonPath)) {
                const data = fs.readFileSync(this.jsonPath, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            console.error('JSONデータ読み込みエラー:', error);
        }
        return null;
    }

    // JSONデータのバックアップを作成
    backupJSONData() {
        try {
            if (fs.existsSync(this.jsonPath)) {
                fs.copyFileSync(this.jsonPath, this.backupPath);
                console.log(`✅ JSONデータのバックアップを作成しました: ${this.backupPath}`);
                return true;
            }
        } catch (error) {
            console.error('バックアップ作成エラー:', error);
        }
        return false;
    }

    // データベースのバックアップを作成
    backupDatabase() {
        try {
            const dbBackupPath = `./voice_timer_backup_${Date.now()}.db`;
            this.db.backup(dbBackupPath);
            return dbBackupPath;
        } catch (error) {
            console.error('データベースバックアップエラー:', error);
            return null;
        }
    }

    // ギルドIDを推測する関数（スケジュールリセットから）
    inferGuildIds(jsonData) {
        const guildIds = new Set();
        
        // スケジュールリセットからギルドIDを取得
        if (jsonData.scheduledResets) {
            jsonData.scheduledResets.forEach(schedule => {
                if (schedule.guildId) {
                    guildIds.add(schedule.guildId);
                }
            });
        }

        // ランキング設定からギルドIDを取得
        if (jsonData.rankingSettings) {
            Object.keys(jsonData.rankingSettings).forEach(guildId => {
                guildIds.add(guildId);
            });
        }

        return Array.from(guildIds);
    }

    // 通話時間データを移行
    migrateVoiceTimeData(jsonData, guildIds) {
        console.log('📊 通話時間データを移行中...');
        let migratedUsers = 0;
        let migratedSessions = 0;

        if (!jsonData.voiceTime) {
            console.log('通話時間データが見つかりません');
            return { migratedUsers, migratedSessions };
        }

        // デフォルトギルドIDを設定（データからギルドIDが特定できない場合）
        const defaultGuildId = guildIds.length > 0 ? guildIds[0] : 'unknown_guild';

        for (const [userId, userData] of Object.entries(jsonData.voiceTime)) {
            try {
                if (userData.totalTime && userData.totalTime > 0) {
                    // 各ギルドに対してデータを移行
                    guildIds.forEach(guildId => {
                        this.db.addVoiceTime(guildId, userId, userData.totalTime);
                        migratedUsers++;
                    });

                    // セッション履歴も移行
                    if (userData.sessions && Array.isArray(userData.sessions)) {
                        userData.sessions.forEach(session => {
                            try {
                                const sessionData = {
                                    channelId: session.channelId || 'unknown_channel',
                                    startTime: session.startTime || Date.now(),
                                    endTime: session.endTime || Date.now()
                                };

                                guildIds.forEach(guildId => {
                                    this.db.addVoiceTime(guildId, userId, 0, sessionData);
                                    migratedSessions++;
                                });
                            } catch (sessionError) {
                                console.error(`セッション移行エラー (${userId}):`, sessionError);
                            }
                        });
                    }
                }
            } catch (error) {
                console.error(`ユーザーデータ移行エラー (${userId}):`, error);
            }
        }

        console.log(`✅ ${migratedUsers}人のユーザーデータを移行しました`);
        console.log(`✅ ${migratedSessions}個のセッションを移行しました`);
        return { migratedUsers, migratedSessions };
    }

    // ロール報酬データを移行
    migrateRoleRewards(jsonData, guildIds) {
        console.log('🎭 ロール報酬データを移行中...');
        let migratedRewards = 0;

        if (!jsonData.roleRewards || !Array.isArray(jsonData.roleRewards)) {
            console.log('ロール報酬データが見つかりません');
            return migratedRewards;
        }

        jsonData.roleRewards.forEach(reward => {
            try {
                guildIds.forEach(guildId => {
                    this.db.addRoleReward(
                        guildId,
                        reward.hours,
                        reward.roleId,
                        reward.roleName
                    );
                    migratedRewards++;
                });
            } catch (error) {
                console.error('ロール報酬移行エラー:', error);
            }
        });

        console.log(`✅ ${migratedRewards}個のロール報酬を移行しました`);
        return migratedRewards;
    }

    // AFKチャンネルデータを移行
    migrateAFKChannels(jsonData, guildIds) {
        console.log('💤 AFKチャンネルデータを移行中...');
        let migratedChannels = 0;

        if (!jsonData.afkChannels || !Array.isArray(jsonData.afkChannels)) {
            console.log('AFKチャンネルデータが見つかりません');
            return migratedChannels;
        }

        jsonData.afkChannels.forEach(channelId => {
            try {
                guildIds.forEach(guildId => {
                    this.db.addAFKChannel(guildId, channelId);
                    migratedChannels++;
                });
            } catch (error) {
                console.error('AFKチャンネル移行エラー:', error);
            }
        });

        console.log(`✅ ${migratedChannels}個のAFKチャンネルを移行しました`);
        return migratedChannels;
    }

    // スケジュールリセットデータを移行
    migrateScheduledResets(jsonData) {
        console.log('⏰ スケジュールリセットデータを移行中...');
        let migratedSchedules = 0;

        if (!jsonData.scheduledResets || !Array.isArray(jsonData.scheduledResets)) {
            console.log('スケジュールリセットデータが見つかりません');
            return migratedSchedules;
        }

        jsonData.scheduledResets.forEach(schedule => {
            try {
                this.db.addScheduledReset({
                    id: schedule.id,
                    guildId: schedule.guildId,
                    originalDatetime: schedule.originalDatetime,
                    nextExecution: schedule.nextExecution,
                    recurring: schedule.recurring || 'none',
                    createdBy: schedule.createdBy,
                    active: schedule.active !== false,
                    executionCount: schedule.executionCount || 0
                });
                migratedSchedules++;
            } catch (error) {
                console.error('スケジュール移行エラー:', error);
            }
        });

        console.log(`✅ ${migratedSchedules}個のスケジュールを移行しました`);
        return migratedSchedules;
    }

    // ランキング設定データを移行
    migrateRankingSettings(jsonData) {
        console.log('📊 ランキング設定データを移行中...');
        let migratedSettings = 0;

        if (!jsonData.rankingSettings) {
            console.log('ランキング設定データが見つかりません');
            return migratedSettings;
        }

        Object.entries(jsonData.rankingSettings).forEach(([guildId, settings]) => {
            try {
                this.db.updateRankingSettings(guildId, {
                    channel_id: settings.channelId,
                    show_on_reset: settings.showOnReset !== false ? 1 : 0,
                    show_top_count: settings.showTopCount || 10
                });
                migratedSettings++;
            } catch (error) {
                console.error('ランキング設定移行エラー:', error);
            }
        });

        console.log(`✅ ${migratedSettings}個のランキング設定を移行しました`);
        return migratedSettings;
    }

    // メイン移行処理
    async migrate() {
        console.log('🚀 データ移行を開始します...');
        console.log(`📅 開始時刻: ${formatJSTDate()}`);

        // バックアップ作成
        console.log('\n📁 バックアップ作成中...');
        this.backupJSONData();
        const dbBackupPath = this.backupDatabase();

        // JSONデータを読み込み
        const jsonData = this.loadJSONData();
        if (!jsonData) {
            console.log('❌ JSONデータが見つかりません。移行を中止します。');
            return false;
        }

        console.log('✅ JSONデータを読み込みました');

        // ギルドIDを推測
        const guildIds = this.inferGuildIds(jsonData);
        console.log(`🔍 検出されたギルドID: ${guildIds.length > 0 ? guildIds.join(', ') : '検出されませんでした'}`);

        if (guildIds.length === 0) {
            console.log('⚠️  ギルドIDが検出されませんでした。デフォルトギルドで移行を継続します。');
            guildIds.push('default_guild');
        }

        // データを移行
        console.log('\n📦 データ移行中...');
        const voiceStats = this.migrateVoiceTimeData(jsonData, guildIds);
        const rewardStats = this.migrateRoleRewards(jsonData, guildIds);
        const afkStats = this.migrateAFKChannels(jsonData, guildIds);
        const scheduleStats = this.migrateScheduledResets(jsonData);
        const rankingStats = this.migrateRankingSettings(jsonData);

        // 移行結果を表示
        console.log('\n🎉 データ移行が完了しました！');
        console.log('=====================================');
        console.log(`📊 通話時間データ: ${voiceStats.migratedUsers}人`);
        console.log(`📝 セッション履歴: ${voiceStats.migratedSessions}個`);
        console.log(`🎭 ロール報酬: ${rewardStats}個`);
        console.log(`💤 AFKチャンネル: ${afkStats}個`);
        console.log(`⏰ スケジュール: ${scheduleStats}個`);
        console.log(`📊 ランキング設定: ${rankingStats}個`);
        console.log('=====================================');
        console.log(`📅 完了時刻: ${formatJSTDate()}`);

        if (dbBackupPath) {
            console.log(`💾 データベースバックアップ: ${dbBackupPath}`);
        }
        console.log(`💾 JSONバックアップ: ${this.backupPath}`);

        return true;
    }

    // 移行確認
    verify() {
        console.log('\n🔍 移行データの確認中...');
        
        // 基本統計を表示
        const guilds = this.db.db.prepare('SELECT COUNT(*) as count FROM guilds').get();
        const voiceData = this.db.db.prepare('SELECT COUNT(*) as count FROM voice_time').get();
        const sessions = this.db.db.prepare('SELECT COUNT(*) as count FROM voice_sessions').get();
        const rewards = this.db.db.prepare('SELECT COUNT(*) as count FROM role_rewards').get();
        const afkChannels = this.db.db.prepare('SELECT COUNT(*) as count FROM afk_channels').get();
        const schedules = this.db.db.prepare('SELECT COUNT(*) as count FROM scheduled_resets').get();

        console.log('データベース統計:');
        console.log(`- ギルド数: ${guilds.count}`);
        console.log(`- 通話時間レコード数: ${voiceData.count}`);
        console.log(`- セッション履歴数: ${sessions.count}`);
        console.log(`- ロール報酬数: ${rewards.count}`);
        console.log(`- AFKチャンネル数: ${afkChannels.count}`);
        console.log(`- スケジュール数: ${schedules.count}`);
    }

    // クリーンアップ
    cleanup() {
        this.db.close();
    }
}

// 移行実行スクリプト
if (require.main === module) {
    const migration = new DataMigration();
    
    migration.migrate()
        .then(success => {
            if (success) {
                migration.verify();
                console.log('\n✅ 移行が正常に完了しました！');
            } else {
                console.log('\n❌ 移行に失敗しました。');
            }
        })
        .catch(error => {
            console.error('\n💥 移行中にエラーが発生しました:', error);
        })
        .finally(() => {
            migration.cleanup();
        });
}

module.exports = DataMigration;
