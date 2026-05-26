# Bottom Timeline MVP Design

## Context

Movemap already has the core music-driven formation behavior:

- `+ Formation` creates a formation at the current audio time.
- New formations copy previous formation positions.
- The new formation is selected immediately.
- A simple `formation-rail` and transport range already exist.

The next MVP step is to turn the existing rail and range into a focused bottom timeline that feels closer to a lightweight video editor, without copying the dense menu surface of Sway Formations.

## Goal

Make the bottom timeline the primary place for music playback, formation selection, and current-time formation creation.

The user should understand this loop immediately:

1. Play or scrub the music.
2. See the current playback head on the timeline.
3. Press `+ Formation` near the timeline.
4. See formation blocks positioned in time.
5. Click a formation block to jump to and edit it.

## Non-Goals

- Real waveform generation or audio analysis.
- Drag-to-retime formation blocks.
- Multi-track production cues.
- Full timeline zoom system.
- Large desktop-style menu redesign.
- New account or plan behavior.

## Interface Requirements

### Layout

The editor should keep three major areas:

- Stage canvas as the main visual editing area.
- Contextual tools through the existing tool drawer/bottom sheet.
- Persistent bottom timeline for music and formations.

The bottom timeline replaces the current lightweight rail/transport presentation. It can reuse existing behavior, but it should look and behave like a timeline surface rather than a list plus range input.

### Timeline Rows

The MVP timeline has two rows:

- `Forms`: formation blocks such as `F1`, `F2`, `F3`.
- `Audio`: an audio track strip.

The audio row can use a waveform-like visual placeholder for this slice. It does not need to parse real waveform data.

### Time Ruler

The timeline should show a ruler based on `timelineMax`.

Minimum behavior:

- Show major ticks at readable intervals.
- Show labels such as `0s`, `10s`, `20s`.
- Keep the ruler aligned with formation block positions and the playback head.

### Playback Head

The playback head should:

- Reflect `sliderTime`.
- Move as audio plays.
- Move when the user scrubs.
- Visually cross the formation and audio rows.

Existing `currentTime`, `duration`, `timelineMax`, and `audioRef.current.currentTime` behavior should remain the source of truth.

### Formation Blocks

Formation blocks should:

- Be positioned by `pointTime(section) / timelineMax`.
- Display compact labels such as `F1`, `F2`, `F3`.
- Show the selected formation state.
- Show the active/current playback formation state.
- Call `jumpTo(section)` when clicked.
- Use `section.name` and formatted arrival time in accessible labels or titles.

Do not introduce drag-retiming in this slice.

### `+ Formation`

The `+ Formation` action should move close to the timeline and continue calling the existing `addSection()`.

The existing behavior remains:

- Capture current audio/playback time.
- Copy previous formation positions.
- Select the new formation.

### Mobile Behavior

The timeline should remain usable on mobile:

- It may scroll horizontally for long songs.
- It should not cover the selected formation controls.
- Touch targets for playback, add formation, and formation blocks should remain usable.

## Data And State

No plan schema change is required for this slice.

Use existing state:

- `sortedSections`
- `selectedSection`
- `timeSectionIndex`
- `sliderTime`
- `timelineMax`
- `currentTime`
- `duration`
- `isPlaying`
- `audioRef`

If helper logic is needed, prefer pure helpers for:

- Converting time to percent.
- Choosing tick spacing.
- Building formation block labels.

## Reuse Assessment

### HitCut

HitCut has a mature editor timeline under `/home/ydhcjswo/projects/HitCut/apps/web/src/components/editor/Timeline.tsx` and `/home/ydhcjswo/projects/HitCut/apps/web/src/components/editor/timeline/`.

Do not copy the full HitCut timeline into Movemap:

- It is TypeScript and Tailwind-based while Movemap is plain React/CSS.
- It depends on HitCut stores such as `useProjectStore`, `useTimelineStore`, `useEngineStore`, and `useUIStore`.
- It depends on `@openreel/core`, `@openreel/ui`, beat-sync bridges, clip models, track models, and editor-specific menus.
- HitCut's full timeline solves video clip editing; Movemap only needs formation markers plus an audio row.

Useful HitCut ideas to adapt:

- Time ruler tick spacing based on pixels-per-second.
- Playhead as an overlay line crossing all timeline rows.
- Two-row track layout with labels on the left and timed content on the right.
- Utility-style separation for time-to-position, tick generation, max scroll, and waveform placeholder path generation.

Implementation choice:

- Build a small Movemap-specific timeline.
- If code is reused from HitCut, limit it to small MIT-compatible helper logic and keep it dependency-free.
- Do not import HitCut packages or workspace modules.

### External Open Source

External timeline/video editor packages are not the default for this slice:

- React Video Editor and similar SDKs provide multi-track video timelines, but their model is heavier than Movemap's two-row formation/audio timeline.
- Twick and VideoFlow target full video editor SDK use cases with canvas/render/export concepts that are outside this MVP slice.
- Wavesurfer.js is relevant later if Movemap needs a real analyzed audio waveform, but the MVP only needs a waveform-like audio strip.
- Field UI is promising for future audio-first controls, but it would add a new design system dependency before Movemap's timeline interaction model is stable.

Implementation choice:

- Do not add a timeline library for the MVP.
- Revisit Wavesurfer.js or an audio-first component library only when real waveform rendering becomes a requirement.
- Keep the first timeline implementation local, small, and easy to replace.

## Acceptance Criteria

- The bottom timeline is visible in the main editor.
- The timeline has a visible time ruler.
- The timeline has a `Forms` row with formation blocks.
- The timeline has an `Audio` row with an audio-track visual.
- The playback head reflects the current playback/scrub time.
- Clicking a formation block jumps to and selects that formation.
- `+ Formation` remains available near the timeline and preserves existing add behavior.
- Read-only share mode does not expose editing-only add controls.
- Existing share/export/audio behavior still works.
- Desktop and mobile layouts do not overlap incoherently.

## Test Plan

Automated:

- Existing `npm test` must pass.
- Add source or helper tests for timeline labels/positioning if helper functions are extracted.
- Keep existing movement timing tests passing.

Build:

- `npm run build` must pass.

Manual:

- Load a project with audio.
- Scrub the timeline and confirm playback head/readout update.
- Click formation blocks and confirm the selected formation changes.
- Press `+ Formation` while audio is at a non-zero time and confirm a new formation appears at that point.
- Confirm read-only share view has playback/review controls but no `+ Formation`.
- Check a narrow mobile viewport for timeline/stage overlap.

## Implementation Notes

- Prefer evolving the current `formation-rail` and `transport` markup before creating a large new component hierarchy.
- Keep menu count low; do not add Sway-style left mode navigation.
- Keep visual density in the bottom timeline, not in global menus.
- Avoid changing data persistence in this slice.
