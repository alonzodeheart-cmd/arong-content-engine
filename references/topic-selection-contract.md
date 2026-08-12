# Topic selection contract

## Supplied topic

Preserve the user's core question. Register it as `user_provided`; do not replace it with a more viral but different topic.

## Search personal materials

1. Read the private source map from `config/profile.local.json`.
2. Search only the paths listed there and only for the current request.
3. Return 3–7 candidates with a source path, date when available, target reader, conflict, evidence, and overlap risk.
4. Label evidence as `[本人原话]`, `[外部材料]`, `[AI整理]`, or `[待确认]`.
5. Wait for the user to select a candidate before creating a task or drafting.

Search is read-only. It does not authorize ingesting, moving, merging, or rewriting source files. If the private source map is missing, ask the user to configure it; do not search the whole computer.

## Hard gate

- Before selection, do not run `new` and do not create a task folder.
- For a library-selected topic, record the chosen source, date, or candidate ID as `topic_evidence`.
- AI summaries must never be recorded as the user's original words.
