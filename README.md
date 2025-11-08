# 数独ゲーム - Minimal Hints Challenge

ブラウザで遊べる数独ゲームです。最小ヒント数の難しい問題に挑戦できます。

## 特徴

- **最小ヒント数**: Python版の数独生成ロジックを参考にした、一意解を持つ最小ヒント数の問題
- **シンプルなUI**: HTML/CSS/JavaScriptのみで動作
- **レスポンシブデザイン**: スマートフォンでも快適にプレイ可能
- **タイマー機能**: プレイ時間を記録
- **ヒント機能**: 困ったときのヘルプ機能

## 遊び方

1. ページを開くと自動的に新しい問題が生成されます
2. 空白のマスをクリックして選択
3. 数字ボタンまたはキーボードで数字を入力
4. 「答え合わせ」ボタンで正誤確認
5. 完成すると自動的に正解判定されます

## 機能

- **新しいゲーム**: ランダムな数独問題を生成
- **答え合わせ**: 現在の入力内容をチェック
- **チートモード**: ヒント機能のON/OFF（Ctrl+Shift+C）
- **ヒント**: 選択中のセルに正解を表示（チートモードON時のみ）
- **解答表示**: 完全な解答を表示（ゲーム終了）

## ローカルで実行

```bash
# このリポジトリをクローン
git clone https://github.com/YOUR-USERNAME/sudoku-game.git

# ディレクトリに移動
cd sudoku-game

# index.htmlをブラウザで開く
# Windowsの場合
start index.html

# macOS/Linuxの場合
open index.html
```

または、ダブルクリックで index.html を開くだけでも動作します。

## GitHub Pagesでの公開

このゲームはGitHub Pagesで無料公開できます：

1. GitHubにリポジトリを作成
2. このコードをプッシュ
3. リポジトリの Settings > Pages で "Deploy from a branch" を選択
4. main ブランチを選択して Save
5. 数分後に `https://YOUR-USERNAME.github.io/sudoku-game/` でアクセス可能

## 技術スタック

- HTML5
- CSS3 (Grid Layout, Flexbox)
- Vanilla JavaScript (ES6+)

## ライセンス

MIT License

## 参考

このプロジェクトは、Python版の数独システムのロジックを参考にして作成されました。
