# Music Action Priority Design

Date: 2026-05-21
Project: StageMap

## Goal

Move music upload and replacement out of the main repeated-work controls. The editing surface should prioritize formation work: play the track, add a formation, adjust the stage, and undo or redo edits.

Music upload must remain discoverable, but it should read as project metadata or setup. It is never the main repeated-work CTA, including before the first upload.

## User Decisions

- Use the C+A direction from brainstorming: state-aware music controls plus a formation-first main control row.
- Music is optional. Users must be able to create and edit formations before uploading audio.
- When no music exists, the main action is `대형 추가`, not a music upload CTA.
- When music exists, the main action is `현재 시간에 대형 만들기`.
- Project name and music upload or replacement should sit on one line, not as a two-line metadata block.
- Playback and formation creation should be close together.
- Undo and redo are high-priority editing actions and should stay in the top-right edit tool cluster.
- JSON `저장하기` is more reusable than music upload/replacement, but it stays in the share/backup panel rather than the main editor header.
- Use `hasUsableAudio` only for audio-dependent playback and lower-row controls. Use explicit music lifecycle state for title-row labels and actions.

## Proposed Layout

### Top Left: Project And Music Metadata

Use one compact inline row:

- No music: `프로젝트명 · 음악 업로드`
- Music uploaded: `프로젝트명 · <file name> 교체`
- Load failed: `프로젝트명 · 음악 로드 실패 다시 연결`

The project title remains the anchor. Music actions use a smaller secondary button style so they remain visible without competing with formation creation.

Long project titles and long file names truncate with ellipsis. On narrow mobile widths, preserve one header row with this priority:

1. Keep the edit tool cluster reachable.
2. Keep the music action button reachable.
3. Truncate the file name before truncating the project title.
4. Shorten action labels to `업로드`, `교체`, and `재연결`.
5. If the row still cannot fit, hide the file name and keep only project title plus action.
6. At the narrowest supported width, collapse the music action to an icon-sized button with an accessible label before hiding edit tools.

The inline row should use nowrap, min-width: 0, overflow: hidden, and text-overflow: ellipsis on the text segments rather than wrapping into a taller header.

### Top Right: Edit Tools

Keep the top-right cluster reserved for editing controls:

- Undo
- Redo
- Grid snapping
- Stage focus or expand

Music upload, replacement, and JSON save should not be placed in this cluster because they would compete with high-frequency editing controls.

### Project Persistence Actions

Keep JSON `저장하기` visually available, but treat it as a secondary project action:

- It stays in the existing share/backup panel as the canonical placement.
- It should not be placed between `Play` and `대형 추가` / `현재 시간에 대형 만들기`.
- It should rank below undo/redo and below the playback-to-formation capture controls.
- It is out of the mobile editor header priority stack, so it should not force title/music/edit tools to wrap.

### Lower Control Row: Playback And Formation Creation

Place formation creation next to playback:

- No music: hide the playback button and show `대형 추가` as the first visible lower-row control, followed by available timeline or position controls.
- Music uploaded: `Play` then `현재 시간에 대형 만들기`, followed by the playback range and time readout.

This keeps the repeated rehearsal workflow compact: play, capture the next formation, adjust timing.

## State Behavior

### No Music

- Show `음악 업로드` inline beside the project title.
- Keep the formation timeline and stage editing available.
- Use `대형 추가` as the primary action near playback.
- Hide playback controls that require audio, including play, playback range, and current audio time readout. Do not show disabled or inert audio controls.
- Do not imply that uploading music is required to start.

### Music Uploaded

- Show the file name inline beside the project title.
- Show `교체` as a secondary inline action.
- Use `현재 시간에 대형 만들기` as the primary action near playback.
- Preserve existing playback range and current-time readout behavior.
- During replacement upload, keep the previous track active until the new upload succeeds.
- If replacement fails, keep the previous track, show a failure status, and leave the inline action available as `교체`.

### Music Load Failed

- Keep the failure state in the same inline music position.
- Replace the secondary action with `다시 연결`.
- Use a warning text color for the status and a secondary warning button for `다시 연결`, but do not move the action into the main formation control row.
- During reconnect, show `연결 중...`; on success return to the music-uploaded state; on failure keep `음악 로드 실패` and re-enable `다시 연결`.

### Upload Lifecycle

- File picker canceled: leave the previous state unchanged and show no error.
- Upload in progress: disable the inline music action and show `업로드 중...` or `교체 중...`.
- Upload success: update the inline file name and switch the lower-row primary action to `현재 시간에 대형 만들기`.
- Invalid or unsupported file: keep the previous state and show a non-blocking status message.
- Initial upload failure: keep the no-music state, re-enable `음악 업로드`, and show a non-blocking status message.
- Replacement failure: keep the previous track active, re-enable `교체`, and show a non-blocking status message.
- Non-blocking status messages appear in the existing app status area, use direct copy such as `음악 업로드 실패` or `지원하지 않는 파일입니다`, and clear on the next successful music action or project edit.

### Read-Only Shared View

- Hide upload, replacement, and reconnect actions.
- Always show the project title.
- If audio exists, show the file name or generic `음악 포함` status as read-only text.
- If no audio exists, omit the music status text rather than showing a missing-audio warning.
- If saved audio fails to load, show `음악 로드 실패` as read-only text and do not show `다시 연결`.
- Playback controls require usable audio.
- Formation navigation remains available with or without audio.

## Implementation Notes

- Refactor the current transport row so music file input is no longer the first main control.
- Add the inline title/music action area to the stage title block. Do not place it in the top-right stage tool cluster.
- Keep JSON `저장하기` in the existing share/backup panel; do not add it to the main editor header in this change.
- Keep file inputs accessible through styled labels, but use secondary styling.
- Ensure mobile layout keeps the title row on one line where possible and truncates text rather than wrapping into a tall header.
- Keep undo and redo in the existing stage corner tool area or equivalent top-right edit tool cluster.
- Ensure the lower control row always visually groups playback and formation creation.
- Define `hasUsableAudio` as true only after the current audio source is confirmed playable. Track saved-audio load failure and upload/replacement failure separately so a failed replacement does not hide playback for the previous track.
- Guard all mutating music actions with `!readonly`, including moved inline actions and any remaining transport-level reconnect or file input controls.

## Testing

- Build the app with `npm run build`.
- Verify no-music state: `음악 업로드` is visible inline, `대형 추가` is the primary repeated action, and formation editing is not blocked.
- Verify no-music state hides playback controls that require audio.
- Verify music-uploaded state: file name and `교체` appear inline, and `현재 시간에 대형 만들기` sits next to playback.
- Verify music load failure: `다시 연결` appears inline and remains discoverable.
- Verify replacement failure keeps the previous track active.
- Verify mobile portrait: project title truncates, upload/replacement labels remain visible, and playback plus formation creation stay close.
- Verify read-only mode hides mutating music actions.
- Because the repo currently has no UI test script, run these as a manual browser checklist unless an implementation plan adds a browser smoke test.

## Out Of Scope

- Changing audio storage behavior.
- Changing project sharing semantics.
- Redesigning the entire mobile tab system.
- Adding a new project settings menu.
