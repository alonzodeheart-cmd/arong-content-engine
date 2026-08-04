# Visual Production Contract

## Text-first cover

- Make the title, not the background, the first visual subject.
- Use a 6–14 Chinese-character hook in 2–4 lines. Prefer three semantic lines for 9–14 characters, usually 2–5 characters per line, so one long line does not shrink the whole title. Judge it at mobile-feed thumbnail size; do not impose an arbitrary maximum text area.
- Generate or select a topic-related full-frame background, then darken, desaturate, and soften it so it supports rather than competes with the title.
- Use solid white Black/Heavy serif or an approved personal typeface. Let the longest line occupy roughly 82%–88% of the canvas width, keep line spacing tight, and avoid a thin outline. Do not ask an image model to draw the final Chinese text.
- Re-layout for each aspect ratio instead of mechanically cropping.
- `dbs-cover` may audit the hook and platform ratios; this contract overrides generic visual-metaphor preferences unless the user asks for another style.

The deterministic helper `scripts/render-text-first-cover.py` can place approved text over an existing text-free background.

## Motion-first video

Before choosing a page layout, write one motion thesis:

`This video proves <claim> by showing <core object> changing from <start state> to <end state>.`

Each beat records:

- `narrative_job`
- `main_moving_object`
- `state_change`
- `camera_motion`
- `text_role`
- `asset_need`
- `motion_kind`
- `ppt_risk`

Default to 5–12 second beats. A beat longer than 15 seconds needs at least two visible state changes or must be split. Generated images must do narrative work and enter the motion system through crop, mask, depth, parallax, scan, or transformation.

When `rn-motion-director` is installed, use it for the motion thesis, beat graph, and Anti-PPT review. Otherwise apply this bundled equivalent and never claim that the external skill ran.

## Anti-PPT hard gate

Stop before full rendering if any condition is true:

- the storyboard is mostly pages, cards, headings, and fades;
- the same layout appears three times consecutively;
- objects appear but never move, connect, split, transform, or produce a result;
- an `ai_scene` has no actual asset;
- a diagram has no `motion_kind` or `state_change`;
- fewer than 80% of beats contain visible state change beyond fade/slide;
- long text carries the visual information;
- representative frames look like one repeated slide template.

Passing requires visible state change in at least 80% of beats, a visual system that continues through the video, and substantive motion even when components are reused.

## Low-cost preview gate

After script and storyboard approval, render only a 20–30 second 9:16 preview:

1. Choose 2–4 beats representing the hook, core mechanism, and one turn.
2. Use real narration and exact captions.
3. Export the MP4 and 3–5 representative frames.
4. Review type size, semantic match, motion continuity, and thumbnail readability.
5. Render the full 3–5 minute video only after the user approves the visual direction.

Keep previews under `06-媒体成品/测试预览/`; do not place them in the publishing package.
