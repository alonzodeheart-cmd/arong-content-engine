# Workflow Contract

## States

Use a task folder with these logical states:

`idea → content diagnosis → co-writing → article review → article approved → independent title/opening/cover selections → video script review → script approved → visual preview review → rendered → publishing package → published → review`

Each approval is real. Do not assume consent because an option looks best.

## Article workflow

1. Record the original topic and evidence.
2. Diagnose the reader, conflict, factual limits, and intended action.
3. Co-write from real material; create a full draft only after the direction is confirmed.
4. Preserve AI diagnostic reports. Only apply edits after the user agrees.
5. After approval, create a WeChat-ready HTML version with `dbs-wechat-html` when available. Use `minimal` by default; use another style only when the user explicitly requests it. It formats only; the Markdown remains the source of truth.
6. End naturally. Do not add a generic lead-generation CTA unless the user explicitly asks.

## Video workflow

- Rewrite rather than read the article aloud.
- Aim for one 9:16 vertical video of 3–5 minutes.
- Follow `visual-production-contract.md`: write the motion thesis and state changes before choosing layouts.
- Render only a 20–30 second preview and representative frames first. Full rendering requires explicit visual approval.
- Use short spoken sentences and introduce a new fact, evidence, turn, or method roughly every 20–40 seconds.
- Stop when the Anti-PPT gate fails: repeated cards, long static scenes, missing assets, subtitle-only rotation, or visible state change below 80%.
- Validate exact audio, subtitles, frame size, duration, and the presence of an audio stream before calling the render finished.

## Independent input contract

Title, opening, and cover are different decisions. Record each selection independently and allow the user to revise one without changing the other two.

The default cover is text-first: 6–14 Chinese characters in 2–4 large lines over a darkened topic-related background. Thumbnail readability, not a maximum text-area percentage, is the approval criterion.

## Publish and review

Publishing stays manual. Capture original platform data at 24 hours, 7 days, and 30 days. Treat any lesson from one post as a candidate pattern, not a universal rule.
