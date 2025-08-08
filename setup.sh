#!/bin/bash

echo "🚀 Voice Chat Timer Discord Bot - セットアップスクリプト"
echo "=================================================="

# 依存関係のインストール
echo "📦 依存関係をインストール中..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ 依存関係のインストールに失敗しました"
    exit 1
fi

echo "✅ 依存関係のインストールが完了しました"

# データ移行の確認
if [ -f "data.json" ]; then
    echo ""
    echo "📁 既存のdata.jsonファイルが見つかりました"
    echo "🔄 データ移行を実行しますか？ (y/n)"
    read -r response
    
    if [[ "$response" =~ ^[Yy]$ ]]; then
        echo "🔄 データ移行を開始します..."
        node migrate.js
        
        if [ $? -eq 0 ]; then
            echo "✅ データ移行が完了しました"
            echo ""
            echo "📋 次の手順："
            echo "1. 古いindex.jsをバックアップ: mv index.js index_old.js"
            echo "2. 新しいindex.jsを使用: mv index_new.js index.js"
            echo "3. Botを起動: npm start"
            echo ""
            echo "⚠️  重要: データ移行後は必ず動作確認を行ってください"
        else
            echo "❌ データ移行に失敗しました"
            echo "詳細はログを確認してください"
            exit 1
        fi
    else
        echo "⏩ データ移行をスキップしました"
        echo "新規セットアップとして続行します"
    fi
else
    echo "📝 新規セットアップです（data.jsonが見つかりません）"
fi

echo ""
echo "🎉 セットアップが完了しました！"
echo ""
echo "📋 使用方法："
echo "1. config.jsonにBotトークンとギルドIDを設定"
echo "2. npm start でBotを起動"
echo ""
echo "🔧 新機能："
echo "- ✅ サーバー分離（各サーバー独立のデータ管理）"
echo "- ✅ SQLiteデータベース（高性能・堅牢性向上）"
echo "- ✅ 日本時間対応（海外サーバー対応）"
echo "- ✅ ボタンエラー修正（強制終了防止）"
echo "- ✅ 堅牢なエラーハンドリング"
echo ""
echo "📚 詳細はREADME.mdを参照してください"
