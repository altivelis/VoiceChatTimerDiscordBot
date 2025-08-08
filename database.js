const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

class VoiceTimerDB {
    constructor(dbPath = './voice_timer.db') {
        this.dbPath = dbPath;
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.initDatabase();
    }

    // データベース初期化
    initDatabase() {
        // ギルド設定テーブル
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS guilds (
                guild_id TEXT PRIMARY KEY,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // ユーザー通話時間テーブル
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS voice_time (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                total_time INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, user_id),
                FOREIGN KEY (guild_id) REFERENCES guilds (guild_id)
            )
        `);

        // セッション履歴テーブル
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS voice_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                start_time INTEGER NOT NULL,
                end_time INTEGER NOT NULL,
                duration INTEGER NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (guild_id) REFERENCES guilds (guild_id)
            )
        `);

        // ロール報酬設定テーブル
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS role_rewards (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                hours INTEGER NOT NULL,
                role_id TEXT NOT NULL,
                role_name TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, hours),
                FOREIGN KEY (guild_id) REFERENCES guilds (guild_id)
            )
        `);

        // AFKチャンネル設定テーブル
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS afk_channels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                guild_id TEXT NOT NULL,
                channel_id TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(guild_id, channel_id),
                FOREIGN KEY (guild_id) REFERENCES guilds (guild_id)
            )
        `);

        // スケジュールリセット設定テーブル
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS scheduled_resets (
                id TEXT PRIMARY KEY,
                guild_id TEXT NOT NULL,
                original_datetime TEXT NOT NULL,
                next_execution INTEGER NOT NULL,
                recurring TEXT NOT NULL DEFAULT 'none',
                created_by TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                active BOOLEAN DEFAULT 1,
                execution_count INTEGER DEFAULT 0,
                FOREIGN KEY (guild_id) REFERENCES guilds (guild_id)
            )
        `);

        // ランキング設定テーブル
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS ranking_settings (
                guild_id TEXT PRIMARY KEY,
                channel_id TEXT,
                show_on_reset BOOLEAN DEFAULT 1,
                show_top_count INTEGER DEFAULT 10,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (guild_id) REFERENCES guilds (guild_id)
            )
        `);

        console.log('データベースの初期化が完了しました');
    }

    // ギルド登録/確認
    ensureGuild(guildId) {
        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO guilds (guild_id) VALUES (?)
        `);
        stmt.run(guildId);
    }

    // 通話時間関連メソッド
    addVoiceTime(guildId, userId, duration, sessionData) {
        this.ensureGuild(guildId);
        
        const transaction = this.db.transaction(() => {
            // 通話時間を更新
            const updateStmt = this.db.prepare(`
                INSERT INTO voice_time (guild_id, user_id, total_time, updated_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT(guild_id, user_id) 
                DO UPDATE SET 
                    total_time = total_time + ?,
                    updated_at = CURRENT_TIMESTAMP
            `);
            updateStmt.run(guildId, userId, duration, duration);

            // セッション履歴を記録
            if (sessionData) {
                const sessionStmt = this.db.prepare(`
                    INSERT INTO voice_sessions 
                    (guild_id, user_id, channel_id, start_time, end_time, duration)
                    VALUES (?, ?, ?, ?, ?, ?)
                `);
                sessionStmt.run(
                    guildId, 
                    userId, 
                    sessionData.channelId, 
                    sessionData.startTime, 
                    sessionData.endTime, 
                    duration
                );
            }
        });

        transaction();
    }

    getVoiceTime(guildId, userId) {
        const stmt = this.db.prepare(`
            SELECT * FROM voice_time 
            WHERE guild_id = ? AND user_id = ?
        `);
        return stmt.get(guildId, userId);
    }

    getGuildRanking(guildId, limit = 10, offset = 0) {
        const stmt = this.db.prepare(`
            SELECT user_id, total_time 
            FROM voice_time 
            WHERE guild_id = ? AND total_time > 0
            ORDER BY total_time DESC 
            LIMIT ? OFFSET ?
        `);
        return stmt.all(guildId, limit, offset);
    }

    getGuildRankingCount(guildId) {
        const stmt = this.db.prepare(`
            SELECT COUNT(*) as count 
            FROM voice_time 
            WHERE guild_id = ? AND total_time > 0
        `);
        return stmt.get(guildId).count;
    }

    // ロール報酬関連メソッド
    addRoleReward(guildId, hours, roleId, roleName) {
        this.ensureGuild(guildId);
        const stmt = this.db.prepare(`
            INSERT INTO role_rewards (guild_id, hours, role_id, role_name)
            VALUES (?, ?, ?, ?)
        `);
        return stmt.run(guildId, hours, roleId, roleName);
    }

    removeRoleReward(guildId, hours) {
        const stmt = this.db.prepare(`
            DELETE FROM role_rewards 
            WHERE guild_id = ? AND hours = ?
        `);
        return stmt.run(guildId, hours);
    }

    getRoleRewards(guildId) {
        const stmt = this.db.prepare(`
            SELECT * FROM role_rewards 
            WHERE guild_id = ? 
            ORDER BY hours ASC
        `);
        return stmt.all(guildId);
    }

    // AFKチャンネル関連メソッド
    addAFKChannel(guildId, channelId) {
        this.ensureGuild(guildId);
        const stmt = this.db.prepare(`
            INSERT OR IGNORE INTO afk_channels (guild_id, channel_id)
            VALUES (?, ?)
        `);
        return stmt.run(guildId, channelId);
    }

    removeAFKChannel(guildId, channelId) {
        const stmt = this.db.prepare(`
            DELETE FROM afk_channels 
            WHERE guild_id = ? AND channel_id = ?
        `);
        return stmt.run(guildId, channelId);
    }

    getAFKChannels(guildId) {
        const stmt = this.db.prepare(`
            SELECT channel_id FROM afk_channels 
            WHERE guild_id = ?
        `);
        return stmt.all(guildId).map(row => row.channel_id);
    }

    // スケジュールリセット関連メソッド
    addScheduledReset(scheduleData) {
        this.ensureGuild(scheduleData.guildId);
        const stmt = this.db.prepare(`
            INSERT INTO scheduled_resets 
            (id, guild_id, original_datetime, next_execution, recurring, created_by, active, execution_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        return stmt.run(
            scheduleData.id,
            scheduleData.guildId,
            scheduleData.originalDatetime,
            scheduleData.nextExecution,
            scheduleData.recurring,
            scheduleData.createdBy,
            scheduleData.active ? 1 : 0,
            scheduleData.executionCount
        );
    }

    getScheduledResets(guildId, activeOnly = true) {
        let query = `
            SELECT * FROM scheduled_resets 
            WHERE guild_id = ?
        `;
        const params = [guildId];
        
        if (activeOnly) {
            query += ` AND active = 1`;
        }
        
        query += ` ORDER BY next_execution ASC`;
        
        const stmt = this.db.prepare(query);
        return stmt.all(...params);
    }

    updateScheduledReset(scheduleId, updates) {
        const setClause = Object.keys(updates).map(key => `${key} = ?`).join(', ');
        const values = Object.values(updates);
        
        const stmt = this.db.prepare(`
            UPDATE scheduled_resets 
            SET ${setClause}
            WHERE id = ?
        `);
        return stmt.run(...values, scheduleId);
    }

    deleteScheduledReset(scheduleId) {
        const stmt = this.db.prepare(`
            UPDATE scheduled_resets 
            SET active = 0 
            WHERE id = ?
        `);
        return stmt.run(scheduleId);
    }

    // ランキング設定関連メソッド
    getRankingSettings(guildId) {
        const stmt = this.db.prepare(`
            SELECT * FROM ranking_settings 
            WHERE guild_id = ?
        `);
        return stmt.get(guildId) || {
            guild_id: guildId,
            show_on_reset: 1,
            show_top_count: 10
        };
    }

    updateRankingSettings(guildId, settings) {
        this.ensureGuild(guildId);
        const stmt = this.db.prepare(`
            INSERT INTO ranking_settings 
            (guild_id, channel_id, show_on_reset, show_top_count, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(guild_id) 
            DO UPDATE SET 
                channel_id = COALESCE(?, channel_id),
                show_on_reset = COALESCE(?, show_on_reset),
                show_top_count = COALESCE(?, show_top_count),
                updated_at = CURRENT_TIMESTAMP
        `);
        return stmt.run(
            guildId,
            settings.channel_id,
            settings.show_on_reset,
            settings.show_top_count,
            settings.channel_id,
            settings.show_on_reset,
            settings.show_top_count
        );
    }

    // リセット機能
    resetGuildData(guildId) {
        const transaction = this.db.transaction(() => {
            // 通話時間とセッション履歴をクリア
            this.db.prepare('DELETE FROM voice_time WHERE guild_id = ?').run(guildId);
            this.db.prepare('DELETE FROM voice_sessions WHERE guild_id = ?').run(guildId);
        });
        
        transaction();
    }

    // データベースを閉じる
    close() {
        this.db.close();
    }

    // バックアップ作成
    backup(backupPath) {
        this.db.backup(backupPath);
        console.log(`データベースのバックアップを作成しました: ${backupPath}`);
    }
}

module.exports = VoiceTimerDB;
