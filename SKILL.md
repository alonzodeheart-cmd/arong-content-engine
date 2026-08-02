---
name: arong-content-engine
description: Turn a creator's confirmed personal thoughts or real experiences into an evidence-aware article, one 3–5 minute vertical video script, and a manual multi-platform publishing package. Use when the user asks to turn an idea into an article/video, find candidates from explicitly scoped personal materials, or continue a content-production workflow.
---

# Arong Content Engine

Treat content production as a recoverable workflow. Local Markdown is the source of truth; every approval and generated asset should remain traceable to a task folder.

## Start correctly

1. Read [workflow-contract.md](references/workflow-contract.md).
2. Read [permissions-and-evidence.md](references/permissions-and-evidence.md).
3. If the user asks to search personal materials, read their private source map first. Do not assume any disk path or search the whole computer.
4. If the user gives a clear topic, register it as user-provided. Do not replace it with a more viral but different topic.

## Topic gate

- For a supplied topic: preserve its core question and record the user's original wording.
- For a request to find topics: return 3–7 candidates with source evidence, a target reader, a conflict, and an evidence label. Wait for the user to choose before creating a task or drafting.
- Search is read-only by default. It never authorizes ingesting or reorganizing source files.

## Co-write instead of interrogating

Before drafting, determine the target reader, concrete problem, core conflict, product relationship, form, and evidence boundary.

- Ask at most one question when a missing answer would change the structure, factual boundary, or the user's stance.
- After 2–4 useful answers, advance with a structure or draft for critique. Do not make the user provide every paragraph.
- Separate `[本人原话]`, `[外部材料]`, `[AI整理]`, and `[待确认]` in task records.
- Do not invent experiences, figures, guarantees, or platform rules.

## Review and approval

1. Draft the article only after the content direction is confirmed.
2. Run an AI-writing diagnostic after the first draft. Keep the report and do not change the article unless the user approves a specific change.
3. After the article is approved, run title, opening, and cover as three independent decisions:
   - title candidates;
   - first-five-second opening candidates;
   - cover hook and visual direction.
4. Do not force the three decisions into an A/B/C bundle or infer one choice from another.
5. Rewrite the approved article into a conversational 3–5 minute, 9:16 vertical video script and a relevant storyboard. Do not make horizontal duplicates or short cut-downs by default.
6. Run a logic-flow check and an AI-writing diagnostic on the video script. Diagnose first; revise only after the user agrees.
7. Lock the approved script before generating audio, subtitles, video, or platform materials.

## Production and publishing

- Use visuals that correspond to the sentence: evidence, data, process diagrams, authorized material, or relevant generated scenes. Do not fill the video with unrelated stock imagery or subtitle cards.
- Generate captions from the final audio, not estimated timing. Keep captions near 68% of frame height and within two lines where possible.
- Generate one 1080×1920 vertical video, 3–5 minutes long, unless the user changes the format.
- Adapt titles and descriptions per platform, but keep the core claim truthful. Keep the long-form body identical on platforms where the user requests it.
- Never auto-publish. Stop at a manual publishing package.

## Optional adapters

If installed, title, hook, cover, AI-check, TTS, subtitle, and rendering tools may be used as adapters. If an adapter is unavailable, explain the gap and continue with the workflow portions that do not depend on it.
