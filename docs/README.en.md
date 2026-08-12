# Arong Content Engine

Arong Content Engine is an open-source, stateful content-production Skill for Codex and other agents that support `SKILL.md`.

It starts from a creator's confirmed ideas or real experiences and produces:

- one reviewed long-form article;
- one 3–5 minute, 1080×1920 vertical video;
- a seven-platform publishing package;
- traceable approvals, hashes, logs, and recovery state.

## Why it exists

Individual AI tools can suggest a title, rewrite an opening, or inspect writing style. The difficult part is keeping those steps consistent: which article did the user approve, whether the video script still matches it, and whether a long TTS or rendering job is running or stuck.

This project treats content production as a recoverable state machine instead of a chain of disposable prompts.

## Core guarantees

- A searched idea is never silently selected for the user.
- Missing personal evidence is left unresolved instead of being invented.
- Article, title, opening, cover, and video script have separate review gates.
- AI-writing checks diagnose first; text changes require user approval.
- Commercial or promotional content passes a dedicated risk review.
- Long-running TTS and Remotion jobs stay in the foreground, emit heartbeats, and write resumable state.
- The workflow produces one official 9:16 video, not a hidden collection of derivative renders.
- Publishing remains a manual user action.

## Quick start

```bash
npx -y skills add alonzodeheart-cmd/arong-content-engine -g --all
```

Copy `config/profile.example.json` to `config/profile.local.json`, configure private source and local media paths, then run:

```bash
node scripts/engine.mjs doctor
node scripts/engine.mjs audit-skill
```

For a reproducible test that does not need private creator data:

```bash
npm install --prefix runtime/remotion
node scripts/prepare-ci-fixture.mjs
export ARONG_CONTENT_PROFILE="$PWD/.ci-fixture/profile.json"
node scripts/engine.mjs self-test
```

The fixture validates the local TTS routing contract without bundling a model or a personal voice. The Remotion video is still rendered for real.

The self-test validates topic-selection gates, approval integrity, portable configuration, the local TTS preflight contract, forbidden behaviors, and an actual 1080×1920 Remotion render.

See the [reproducible demo](../examples/portable-demo/README.md), [workflow contract](../references/workflow-contract.md), and [contribution guide](../CONTRIBUTING.md).

## Privacy

Private profiles, source maps, local TTS routes, voice references, and content tasks are excluded through `.gitignore`. Search is read-only by default and does not authorize ingestion into a knowledge base.

## License

[MIT](../LICENSE)
