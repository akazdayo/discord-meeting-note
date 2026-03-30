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
mise exec -- pnpm --filter @discord-meeting-note/types build
```

## Architecture

Turborepo monorepo with pnpm workspaces. Build order is enforced by `turbo.json` (`dependsOn: ["^build"]`), so packages always build in dependency order.

```
apps/bot/          Discord I/O only — entry point is src/index.ts
packages/
  shared/types/    Core types: AudioBuffer, TranscriptionResult, LLMMessage, LLMResponse
  shared/errors/   Error classes: TranscriptionError, LLMError, DiscordError
  transcription/
    core/          TranscriptionModel interface
    whisper/       Whisper implementation stub
    google-stt/    Google STT implementation stub
    assembly-ai/   AssemblyAI implementation stub
  llm/
    core/          LLMModel interface
    openai/        OpenAI implementation stub
    gemini/        Gemini implementation stub
    ollama/        Ollama implementation stub
```

**Dependency flow:** `types` ← `errors` ← `{transcription,llm}/core` ← `{transcription,llm}/*` ← `bot`

Each package has its own `tsconfig.json` extending the root `tsconfig.json`. TypeScript outputs to `dist/`. The `main`/`types` fields in each `package.json` point to `dist/`.

Linting/formatting is handled by Biome (config at root `biome.json`) with tab indentation and double quotes for JS/TS.

## Environment

- Node.js + pnpm managed via `mise` (not on PATH directly — always prefix with `mise exec --`)
- Nix flake (`flake.nix`) provides an alternative dev shell with `nodejs` + `pnpm`
