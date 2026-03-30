# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All commands must be run via `mise exec --`:

```sh
mise exec -- pnpm install       # install dependencies
mise exec -- pnpm build         # build all packages (turbo)
mise exec -- pnpm dev           # dev mode (turbo, persistent)
mise exec -- pnpm check         # biome lint + format (all packages)
mise exec -- pnpm clean         # remove all dist/ dirs

# run a single package's script
mise exec -- pnpm --filter @discord-meeting-note/bot dev
mise exec -- pnpm --filter @discord-meeting-note/database test

# run tests (vitest, packages that have them)
mise exec -- pnpm --filter @discord-meeting-note/database test
mise exec -- pnpm --filter @discord-meeting-note/transcription-whisper test
```

## Architecture

Turborepo monorepo with pnpm workspaces. Build order is enforced by `turbo.json` (`dependsOn: ["^build"]`).

```
apps/bot/          Discord I/O, slash commands, pipeline orchestration
packages/
  shared/types/    Core types: AudioBuffer, TranscriptionResult, LLMMessage, LLMResponse
  shared/errors/   Error classes: TranscriptionError, LLMError, DiscordError
  database/        DatabaseService (Drizzle ORM + better-sqlite3, WAL mode, inline migration)
  transcription/
    core/          TranscriptionModel interface
    whisper/       Whisper CLI wrapper (implemented) — uses execFile, JSON output format
    google-stt/    Stub
    assembly-ai/   Stub
  llm/
    core/          LLMModel interface
    openai/        OpenAI implementation (implemented)
    gemini/        Stub
    ollama/        Stub
```

**Dependency flow:** `types` ← `errors` ← `database`, `{transcription,llm}/core` ← `{transcription,llm}/*` ← `bot`

Each package has its own `tsconfig.json` extending root. TypeScript outputs to `dist/`. Linting/formatting via Biome (tab indentation, double quotes).

## Data flow

1. `/record start` → `VoiceManager.startSession()` joins the voice channel and records per-user Opus streams in memory (decoded to raw PCM via prism-media)
2. `/record stop` → `VoiceManager.stopSession()` converts each user's PCM to OGG via **ffmpeg** (`s16le 48kHz stereo → libopus`) and writes to `AUDIO_DIR`
3. Tracks are saved to the DB; `processSession()` in `pipeline.ts` runs asynchronously:
   - Transcribes each per-user OGG with Whisper CLI (JSON output format)
   - Combines transcripts with Discord display names
   - Summarizes with OpenAI (「要約」「決定事項」「アクションアイテム」sections in Markdown)
   - Stores transcript + summary in SQLite; updates session status to `done`/`failed`
   - Notifies the requesting user in the original text channel
4. Audio files expire after 7 days; `startCleanupScheduler()` runs hourly to delete expired files and null out `audio_path` in the DB

## Database schema

SQLite (WAL mode) at `DATA_DIR/db.sqlite`. Schema is applied inline at startup via `CREATE TABLE IF NOT EXISTS`. Tables: `sessions`, `session_tracks`, `transcripts`, `summaries`. Session IDs are ULIDs.

Session lifecycle states: `recording` → `processing` → `done` | `failed`

## Slash commands

- `/record start [channel]` — joins voice, starts recording
- `/record stop` — stops recording, triggers pipeline
- `/export audio|transcript|summary <session-id>` — exports session data (audio as OGG attachments; text inline if ≤2000 chars, otherwise as file attachment)
- `/summarize` — re-runs summarization for an existing session

## Environment

`.env` at repo root is loaded by `node --env-file=../../.env` in dev mode and `node --env-file=../../.env dist/index.js` in production.

Required env vars (see `.env.example`):
- `DISCORD_TOKEN` — Discord bot token
- `OPENAI_API_KEY` — OpenAI API key

Optional env vars:
- `OPENAI_MODEL` — defaults to `gpt-4o-mini`
- `WHISPER_CMD` — path to whisper CLI, defaults to `whisper`
- `WHISPER_MODEL` — whisper model size, defaults to `base`
- `DATA_DIR` — directory for SQLite DB and audio files, defaults to `./data`

**External runtime dependency:** `ffmpeg` must be on PATH (used by `VoiceManager` to convert PCM→OGG).

## Environment setup

- Node.js + pnpm managed via `mise` (not on PATH directly — always prefix with `mise exec --`)
- Nix flake (`flake.nix`) provides an alternative dev shell with `nodejs` + `pnpm`
