const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

class VoiceTimerDB {
    constructor(dbPath = './voice_timer.db') {
        this.dbPath = dbPath;
        this.db = new sqlite3.Database(dbPath, (err) => {
            if (err) {
                console.error('データベース接続エラー:', err);
            } else {
                console.log('SQLiteデータベースに接続しました');
                this.initDatabase();
            }
        });
    }

    // データベース初期化
    initDatabase() {
        const queries = [
            // ギルド設定テーブル
            `CREATE TABLE IF NOT EXISTS guilds (
                guild_id TEXT PRIMARY KEY,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // ユーザー通話時間テーブル
            `CREATE TABLE IF NOT EXISTS voice_time (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                total_time INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, user_id)
            )`,
            
            // セッション履歴テーブル
            `CREATE TABLE IF NOT EXISTS voice_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                start_time INTEGER NOT NULL,
                end_time INTEGER NOT NULL,
                duration INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`,
            
            // ロール報酬設定テーブル
            `CREATE TABLE IF NOT EXISTS role_rewards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                hours INTEGER NOT NULL,
                role_id TEXT NOT NULL,
                role_name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, hours)
            )`,
            
            // AFKチャンネル設定テーブル
            `CREATE TABLE IF NOT EXISTS afk_channels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, channel_id)
            )`,
            
            // スケジュールリセット設定テーブル
            `CREATE TABLE IF NOT EXISTS scheduled_resets (
                id TEXT PRIMARY KEY,
                guild_id TEXT NOT NULL,
                original_datetime TEXT NOT NULL,
                next_execution INTEGER NOT NULL,
                recurring TEXT NOT NULL DEFAULT 'none',
                created_by TEXT NOT NULL,
                channel_id TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                active BOOLEAN DEFAULT 1,
                execution_count INTEGER DEFAULT 0
            )`,
            
            // ランキング設定テーブル
            `CREATE TABLE IF NOT EXISTS ranking_settings (
                guild_id TEXT PRIMARY KEY,
                channel_id TEXT,
                show_on_reset BOOLEAN DEFAULT 1,
                show_top_count INTEGER DEFAULT 10,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )`
        ];

        // 順次実行
        this.executeQueries(queries, () => {
            console.log('データベースの初期化が完了しました');
        });
    }

    // クエリを順次実行する補助メソッド
    executeQueries(queries, callback) {
        if (queries.length === 0) {
            return callback();
        }
        
        const query = queries.shift();
        this.db.run(query, (err) => {
            if (err) {
                console.error('クエリ実行エラー:', err);
            }
            this.executeQueries(queries, callback);
        });
    }

    // ギルド登録/確認
    ensureGuild(guildId, callback = () => {}) {
        this.db.run(
            'INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)',
            [guildId],
            callback
        );
    }

    // 通話時間関連メソッド
    addVoiceTime(guildId, userId, duration, sessionData = null) {
        this.ensureGuild(guildId, () => {
            // 通話時間を更新
            this.db.run(
                `INSERT INTO voice_time (guild_id, user_id, total_time, updated_at)
                 VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(guild_id, user_id) 
                 DO UPDATE SET 
                     total_time = total_time + ?,
                     updated_at = CURRENT_TIMESTAMP`,
                [guildId, userId, duration, duration],
                (err) => {
                    if (err) {
                        console.error('通話時間更新エラー:', err);
                        return;
                    }

                    // セッション履歴を記録
                    if (sessionData) {
                        this.db.run(
                            `INSERT INTO voice_sessions 
                             (guild_id, user_id, channel_id, start_time, end_time, duration)
                             VALUES (?, ?, ?, ?, ?, ?)`,
                            [
                                guildId, 
                                userId, 
                                sessionData.channelId, 
                                sessionData.startTime, 
                                sessionData.endTime, 
                                duration
                            ],
                            (err) => {
                                if (err) {
                                    console.error('セッション履歴記録エラー:', err);
                                }
                            }
                        );
                    }
                }
            );
        });
    }

    getVoiceTime(guildId, userId, callback) {
        this.db.get(
            'SELECT * FROM voice_time WHERE guild_id = ? AND user_id = ?',
            [guildId, userId],
            callback
        );
    }

    getGuildRanking(guildId, limit = 10, offset = 0, callback) {
        this.db.all(
            `SELECT user_id, total_time 
             FROM voice_time 
             WHERE guild_id = ? AND total_time > 0
             ORDER BY total_time DESC 
             LIMIT ? OFFSET ?`,
            [guildId, limit, offset],
            callback
        );
    }

    getGuildRankingCount(guildId, callback) {
        this.db.get(
            'SELECT COUNT(*) as count FROM voice_time WHERE guild_id = ? AND total_time > 0',
            [guildId],
            (err, row) => {
                callback(err, row ? row.count : 0);
            }
        );
    }

    // ロール報酬関連メソッド
    addRoleReward(guildId, hours, roleId, roleName, callback = () => {}) {
        this.ensureGuild(guildId, () => {
            this.db.run(
                'INSERT INTO role_rewards (guild_id, hours, role_id, role_name) VALUES (?, ?, ?, ?)',
                [guildId, hours, roleId, roleName],
                callback
            );
        });
    }

    removeRoleReward(guildId, hours, callback) {
        this.db.run(
            'DELETE FROM role_rewards WHERE guild_id = ? AND hours = ?',
            [guildId, hours],
            callback
        );
    }

    getRoleRewards(guildId, callback) {
        this.db.all(
            'SELECT * FROM role_rewards WHERE guild_id = ? ORDER BY hours ASC',
            [guildId],
            callback
        );
    }

    // AFKチャンネル関連メソッド
    addAFKChannel(guildId, channelId, callback = () => {}) {
        this.ensureGuild(guildId, () => {
            this.db.run(
                'INSERT OR IGNORE INTO afk_channels (guild_id, channel_id) VALUES (?, ?)',
                [guildId, channelId],
                callback
            );
        });
    }

    removeAFKChannel(guildId, channelId, callback) {
        this.db.run(
            'DELETE FROM afk_channels WHERE guild_id = ? AND channel_id = ?',
            [guildId, channelId],
            callback
        );
    }

    getAFKChannels(guildId, callback) {
        this.db.all(
            'SELECT channel_id FROM afk_channels WHERE guild_id = ?',
            [guildId],
            (err, rows) => {
                callback(err, rows ? rows.map(row => row.channel_id) : []);
            }
        );
    }

    // スケジュールリセット関連メソッド
    addScheduledReset(scheduleData, callback = () => {}) {
        this.ensureGuild(scheduleData.guildId, () => {
            this.db.run(
                `INSERT INTO scheduled_resets 
                 (id, guild_id, original_datetime, next_execution, recurring, created_by, channel_id, active, execution_count)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    scheduleData.id,
                    scheduleData.guildId,
                    scheduleData.originalDatetime,
                    scheduleData.nextExecution,
                    scheduleData.recurring,
                    scheduleData.createdBy,
                    scheduleData.channelId,
                    scheduleData.active ? 1 : 0,
                    scheduleData.executionCount
                ],
                callback
            );
        });
    }

    getScheduledResets(guildId, activeOnly = true, callback) {
        let query = 'SELECT * FROM scheduled_resets WHERE guild_id = ?';
        const params = [guildId];
        
        if (activeOnly) {
            query += ' AND active = 1';
        }
        
        query += ' ORDER BY next_execution ASC';
        
        this.db.all(query, params, callback);
    }

    updateScheduledReset(scheduleId, updates, callback = () => {}) {
        const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(updates), scheduleId];
        
        this.db.run(
            `UPDATE scheduled_resets SET ${setClause} WHERE id = ?`,
            values,
            callback
        );
    }

    deleteScheduledReset(scheduleId, callback = () => {}) {
        this.db.run(
            'UPDATE scheduled_resets SET active = 0 WHERE id = ?',
            [scheduleId],
            callback
        );
    }

    // ランキング設定関連メソッド
    getRankingSettings(guildId, callback) {
        this.db.get(
            'SELECT * FROM ranking_settings WHERE guild_id = ?',
            [guildId],
            (err, row) => {
                const defaultSettings = {
                    guild_id: guildId,
                    show_on_reset: 1,
                    show_top_count: 10
                };
                callback(err, row || defaultSettings);
            }
        );
    }

    updateRankingSettings(guildId, settings, callback = () => {}) {
        this.ensureGuild(guildId, () => {
            this.db.run(
                `INSERT INTO ranking_settings 
                 (guild_id, channel_id, show_on_reset, show_top_count, updated_at)
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                 ON CONFLICT(guild_id) 
                 DO UPDATE SET 
                     channel_id = ?,
                     show_on_reset = ?,
                     show_top_count = ?,
                     updated_at = CURRENT_TIMESTAMP`,
                [
                    guildId,
                    settings.channel_id,
                    settings.show_on_reset,
                    settings.show_top_count,
                    settings.channel_id,
                    settings.show_on_reset,
                    settings.show_top_count
                ],
                callback
            );
        });
    }

    // リセット機能
    resetGuildData(guildId, callback = () => {}) {
        this.db.serialize(() => {
            this.db.run('DELETE FROM voice_time WHERE guild_id = ?', [guildId]);
            this.db.run('DELETE FROM voice_sessions WHERE guild_id = ?', [guildId], callback);
        });
    }

    // データベースを閉じる
    close() {
        this.db.close((err) => {
            if (err) {
                console.error('データベースクローズエラー:', err);
            } else {
                console.log('データベース接続を閉じました');
            }
        });
    }

    // バックアップ作成（シンプル版）
    backup(backupPath) {
        try {
            if (fs.existsSync(this.dbPath)) {
                fs.copyFileSync(this.dbPath, backupPath);
                console.log(`データベースのバックアップを作成しました: ${backupPath}`);
            }
        } catch (error) {
            console.error('バックアップエラー:', error);
        }
    }
}

module.exports = VoiceTimerDB;
