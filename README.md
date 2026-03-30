# discord-meeting-note

Discord のボイスチャンネルを録音し、文字起こし・要約を行うセルフホスト型ボット。

## 機能

| コマンド | 説明 |
|---|---|
| `/record start [channel]` | ボイスチャンネルに参加して録音を開始 |
| `/record stop` | 録音を停止し、文字起こし・要約を非同期で実行。完了後にメンションで通知 |
| `/export audio <id>` | 録音音声ファイル（OGG）を添付ファイルとして送信 |
| `/export transcript <id>` | 文字起こし結果を送信 |
| `/export summary <id>` | 要約を送信 |
| `/summarize` | 添付音声ファイルを直接文字起こし・要約 |

## 必要なもの

- Node.js 18+
- [mise](https://mise.jdx.dev/)
- [ffmpeg](https://ffmpeg.org/)（libopus 付き）
- [mlx-whisper](https://pypi.org/project/mlx-whisper/)（Python, Apple Silicon 向け）
- OpenAI API キー
- Discord Bot トークン

### ffmpeg のインストール

```sh
# macOS
brew install ffmpeg

# Ubuntu/Debian
apt install ffmpeg
```

### MLX Whisper のインストール

```sh
pip install mlx-whisper

# 動作確認
mlx_whisper -h
```

bot は `@discord-meeting-note/transcription-mlx-whisper` を使って `mlx_whisper` CLI で文字起こしします。

## セットアップ

```sh
# 依存パッケージのインストール
mise exec -- pnpm install

# 環境変数の設定
cp .env.example .env
# .env を編集して各値を入力

# ビルド
mise exec -- pnpm build
```

## 環境変数

| 変数 | 必須 | デフォルト | 説明 |
|---|---|---|---|
| `DISCORD_TOKEN` | ✅ | — | Discord Bot トークン |
| `OPENAI_API_KEY` | ✅ | — | OpenAI API キー |
| `OPENAI_MODEL` | | `gpt-4o-mini` | 要約に使用するモデル |
| `MLX_WHISPER_CMD` | | `mlx_whisper` | MLX Whisper CLI のパス |
| `MLX_WHISPER_MODEL` | | `mlx-community/whisper-base-mlx` | MLX Whisper のモデル識別子 |
| `MLX_WHISPER_LANGUAGE` | | — | MLX Whisper に固定言語を渡す場合の言語コード |
| `DATA_DIR` | | `./data` | DB・音声ファイルの保存先ディレクトリ |

## 起動

```sh
# 開発モード（ファイル変更で自動再起動）
mise exec -- pnpm --filter @discord-meeting-note/bot dev

# 本番モード
mise exec -- pnpm --filter @discord-meeting-note/bot start
```

## データの保存場所

```
data/
├── db.sqlite        # セッション・文字起こし・要約のデータ
└── audio/
    └── <id>.ogg     # 録音音声ファイル（7日後に自動削除）
```

## アーキテクチャ

Turborepo モノレポ。`apps/bot` は Discord I/O のみを担当し、ビジネスロジックは `packages/` に分離。

```
apps/bot/          Discord I/O・コマンド処理
packages/
  database/        Drizzle ORM + SQLite（セッション管理）
  shared/types/    共通型定義
  shared/errors/   カスタムエラークラス
  transcription/
    core/          TranscriptionModel インターフェース
    mlx-whisper/   MLX Whisper ローカル CLI 実装
    whisper/       Whisper ローカル CLI 実装
  llm/
    core/          LLMModel インターフェース
    openai/        OpenAI 実装
```

## 開発

```sh
# ビルド
mise exec -- pnpm build

# Lint / フォーマット
mise exec -- pnpm check

# テスト
mise exec -- pnpm --filter @discord-meeting-note/database test
mise exec -- pnpm --filter @discord-meeting-note/bot build
mise exec -- pnpm --filter @discord-meeting-note/transcription-mlx-whisper test
mise exec -- pnpm --filter @discord-meeting-note/transcription-whisper test
```

## Discord Bot の設定

1. [Discord Developer Portal](https://discord.com/developers/applications) でアプリを作成
2. Bot タブでトークンを発行し `.env` の `DISCORD_TOKEN` に設定
3. OAuth2 → URL Generator で以下のスコープ・権限を付与してサーバーに招待
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Connect`, `Speak`, `Send Messages`, `Attach Files`
