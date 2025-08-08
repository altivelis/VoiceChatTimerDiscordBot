// 日本時間ユーティリティ関数

// 日本時間の取得（UTC+9時間）
function getJSTDate(timestamp = Date.now()) {
    const date = new Date(timestamp);
    // UTC+9時間を追加
    const jstDate = new Date(date.getTime() + (9 * 60 * 60 * 1000));
    return jstDate;
}

// 日本時間での日付文字列フォーマット
function formatJSTDate(timestamp = Date.now()) {
    const jstDate = getJSTDate(timestamp);
    return jstDate.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// 日本時間での短い日付フォーマット
function formatJSTDateShort(timestamp = Date.now()) {
    const jstDate = getJSTDate(timestamp);
    return jstDate.toLocaleDateString('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// 日本時間での日時パース（YYYY-MM-DD HH:MM形式）
function parseJSTDateTime(datetimeStr) {
    try {
        const [datePart, timePart] = datetimeStr.split(' ');
        const [year, month, day] = datePart.split('-').map(Number);
        const [hour, minute] = timePart.split(':').map(Number);
        
        // 日本時間での日付オブジェクト作成
        const jstDate = new Date(year, month - 1, day, hour, minute);
        // UTC時間に変換（-9時間）
        return jstDate.getTime() - (9 * 60 * 60 * 1000);
    } catch (error) {
        throw new Error('日時フォーマットが無効です');
    }
}

// 現在の日本時間を取得
function getJSTNow() {
    return getJSTDate();
}

// 時間をフォーマットする関数（既存）
function formatTime(milliseconds) {
    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}時間${minutes}分`;
}

// 日本時間で日時文字列を検証
function isValidJSTDateTime(datetimeStr) {
    const dateRegex = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;
    const match = datetimeStr.match(dateRegex);
    
    if (!match) {
        return false;
    }
    
    try {
        const timestamp = parseJSTDateTime(datetimeStr);
        const now = Date.now();
        return timestamp > now; // 未来の日時のみ有効
    } catch (error) {
        return false;
    }
}

// Discord のタイムスタンプ形式に変換
function toDiscordTimestamp(timestamp, format = 'F') {
    return `<t:${Math.floor(timestamp / 1000)}:${format}>`;
}

module.exports = {
    getJSTDate,
    formatJSTDate,
    formatJSTDateShort,
    parseJSTDateTime,
    getJSTNow,
    formatTime,
    isValidJSTDateTime,
    toDiscordTimestamp
};
