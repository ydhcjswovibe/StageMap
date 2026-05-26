# Movemap MVP Implementation Status

## Purpose

This document tracks the MVP against the current repo state.

The MVP goal is to prove one workflow:

Load music, add formations at the right moments, revise them quickly, and share a clear review link with team members.

`SPEC.md` defines the product direction. This file is the implementation status board and work queue.

## Status Legend

- `Done`: Implemented and usable in the current app.
- `Needs tests`: Implemented, but the behavior should be locked with targeted tests before related changes.
- `Partial`: Some behavior exists, but the MVP experience is incomplete.
- `Not started`: No meaningful implementation yet.
- `Future`: Keep out of the editing MVP.

## Current Implementation Status

### Music-Driven Formation Creation

Status: `Done` / `Needs tests`

Current evidence:

- `src/App.jsx` has `addSection()`.
- `addSection()` reads `audioRef.current.currentTime || currentTime`.
- New sections are created at the captured time.
- New sections copy positions from the previous section chosen by `findSectionIndex(sortedSections, time)`.
- The new section is selected with `setSelectedSectionId(section.id)`.

Remaining work:

- Add behavior tests so this does not regress during timeline work.
- Document the duplicate-timestamp rule. Current behavior allows adding at the captured time and sorts sections by arrival time.

### Formation Timing Controls

Status: `Done` / `Needs tests`

Current evidence:

- `updateSectionTiming(sectionId, time, moveDuration)` updates `time`, `moveDuration`, `start`, and `end`.
- Selected formation controls expose arrival time, movement start, and movement duration.
- `movementTimingControls.test.mjs` covers key source-level expectations.

Remaining work:

- Add stronger behavior-level helper tests when timing logic is extracted.
- Keep arrival-time edits predictable after timeline UI changes.

### Formation Duplicate And Delete

Status: `Partial`

Current evidence:

- `duplicateSection()` exists.
- `deleteSection()` exists.
- Duplicate copies selected section data and partner set data when present.
- Delete refuses to remove the last remaining section.

Remaining work:

- Deletion currently selects the first remaining section; MVP should select a nearby previous or next section.
- Last-section behavior should be explicit in UI copy.
- Add tests for duplicate/delete selection behavior.

### Stage Editing

Status: `Partial`

Current evidence:

- Performer tokens can be dragged on the stage.
- Pair/partner behavior exists.
- Snap toggle exists.
- Undo/redo infrastructure exists through `updatePlan()`, `undoPlan()`, and `redoPlan()`.

Remaining work:

- Multi-select performer movement is not implemented.
- Role/part group selection is not implemented as an MVP editing accelerator.
- Alignment/distribution tools are not implemented.

### Transition Path Readability

Status: `Partial`

Current evidence:

- Live stage rendering shows ghost positions from the previous formation.
- Live stage rendering draws movement arrows from the previous formation to the active formation.
- Export/read-only SVG rendering also includes previous-position ghosts and arrows.
- Selected performer dimming affects path opacity.

Remaining work:

- Add a show/hide movement path toggle.
- Make selected performer path emphasis clearer.
- Add path clutter handling for larger teams.
- Reuse the same transition readability model in shared review.

### Timeline / Formation Rail

Status: `Partial`

Current evidence:

- `formation-rail` lists formation chips.
- Clicking a chip calls `jumpTo(section)`.
- Transport has play/pause, `대형 추가`, a range input, and time readout.

Remaining work:

- Replace the current rail/range control with a CapCut-style bottom timeline.
- Add time ruler.
- Add playback head.
- Show formation blocks positioned by arrival time.
- Show audio track or waveform-like strip.
- Keep `+ Formation` near the timeline.
- Do not add a large desktop-style menu system.

### Sharing / Read-Only Review

Status: `Partial`

Current evidence:

- Share route is detected from `/share/:id`.
- `loadCloudProject()` loads shared projects.
- Read-only mode hides editing actions.
- Share link creation saves through cloud persistence.
- JSON, PNG, and print/PDF fallback sharing exist.

Remaining work:

- Shared review should make current and next formation clearer.
- Shared mobile review needs a focused playback/timeline experience.
- Editing controls should remain hidden in read-only views.

### Account And Plan Model

Status: `Not started`

Target model:

- Guest: local editing, JSON import/export, basic PNG/PDF, no cloud projects, no share links.
- Free Google login: up to 2 cloud projects, share links for saved projects, one audio file per project.
- Paid candidate: more projects, larger audio storage, share management, templates, version history, team/class workspace.

Remaining work:

- Google login is not implemented.
- Guest/account state is not implemented.
- Free project limit enforcement is not implemented.
- Billing is intentionally out of scope for the editing MVP.

### App Packaging

Status: `Future`

Direction:

- Keep the app web-first.
- Keep shared review links browser-accessible.
- Isolate file, audio, share, and auth behavior enough to support future app packaging.
- Do not start a native rewrite in the MVP.

## Revised Work Order

### Slice 0: Baseline Tests For Existing Formation Flow

Goal:

- Lock the behavior that already exists so timeline work does not accidentally break it.

Scope:

- Test current-time formation creation.
- Test previous-formation position copy.
- Test immediate selection of the new formation.
- Capture the current duplicate-timestamp behavior or define the rule before changing it.

Likely files:

- `src/App.jsx`
- `src/sectionPolicy.mjs`
- `src/sectionPolicy.test.mjs`
- `src/movementTimingControls.test.mjs`

Completion criteria:

- Existing `+ Formation` behavior is covered.
- No visible UI change is required.
- `npm test` and `npm run build` pass.

### Slice 1: Bottom Timeline MVP

Goal:

- Make the bottom timeline the primary editing control.

Scope:

- Replace or evolve the existing `formation-rail` and transport range into a persistent bottom timeline.
- Show a time ruler.
- Show a playback head.
- Show formation blocks positioned by arrival time.
- Show an audio track or waveform-like strip.
- Keep `+ Formation` near the timeline.
- Selecting a formation block should call the same selection/jump behavior as the current rail.

Out of scope:

- Real waveform analysis.
- Drag retiming.
- Multi-track production cues.
- Large side menu redesign.

Completion criteria:

- Timeline is visible and readable on desktop and mobile widths.
- Formation blocks reflect sorted section arrival times.
- Clicking a formation block selects/jumps to that formation.
- Existing creation, sharing, and export behavior still works.
- `npm test` and `npm run build` pass.

### Slice 2: Timeline Retiming

Goal:

- Let users adjust formation timing from the editing surface.

Scope:

- Edit selected formation arrival time from the timeline or selected formation panel.
- Keep sections sorted by arrival time.
- Preserve movement-duration semantics.
- Keep selected formation stable after retiming.
- Make timing edits undoable.

Decision to make in the detailed spec:

- Whether drag-to-retime ships in this slice or remains a later enhancement.

### Slice 3: Formation Management Polish

Goal:

- Make duplicate/delete behavior feel safe in repeated editing.

Scope:

- Duplicate selected formation with copied positions and partner data.
- Delete selected formation.
- Select nearest previous or next formation after deletion.
- Keep last-section behavior explicit.
- Preserve undo/redo.

### Slice 4: Multi-Select Performer Movement

Goal:

- Let users revise changed performers without moving them one by one.

Scope:

- Select multiple performers.
- Move selected performers together.
- Keep existing single-performer and pair movement intact.
- Clear or preserve selection on formation change using one explicit rule.

Decision to make in the detailed spec:

- First interaction model: shift-click, drag-box, or role/part selection.

### Slice 5: Basic Alignment Tools

Goal:

- Speed up cleanup after copying a previous formation.

Scope:

- Align selected performers horizontally.
- Align selected performers vertically.
- Distribute selected performers evenly.
- Center selected performers as a group.
- Show these controls only when multi-selection exists.

### Slice 6: Transition Readability

Goal:

- Help users and team members understand movement between formations.

Scope:

- Add show/hide movement paths.
- Emphasize selected performer path.
- Reduce clutter for many performers.
- Prepare the path model for read-only shared review.

### Slice 7: Shared Review MVP

Goal:

- Make the shared link easier for team members to understand.

Scope:

- Preserve view-only share links.
- Improve shared playback with music.
- Show current and next formation labels.
- Keep mobile shared view readable.
- Hide editing-only controls.

### Slice 8: Account And Plan Foundation

Goal:

- Prepare guest, free login, and paid-plan boundaries after the editing MVP is strong.

Scope:

- Google login.
- Guest/account state.
- Free Google users can save up to 2 cloud projects.
- Free Google users can create share links for saved projects.
- Paid plan represented as model/state only; billing can come later.

## MVP Exclusions

Do not include these in the editing MVP:

- Full native app rewrite
- Realtime collaborative editing
- Full team workspace
- Comments and feedback
- Automatic beat analysis
- Video export
- 3D editing
- Complex desktop-style menu system
- Full billing implementation
- Advanced share-link permissions

## Documentation Flow

Use this document as the status board and implementation queue.

For each slice:

1. Create a detailed design document under `docs/superpowers/specs/`.
2. Define acceptance criteria before editing code.
3. Create an implementation plan under `docs/superpowers/plans/` if the slice is large enough to need one.
4. Implement and verify the slice.

The first detailed design is `docs/superpowers/specs/2026-05-26-bottom-timeline-mvp-design.md`.
