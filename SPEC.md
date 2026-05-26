# Movemap Product Spec

## Product Direction

Movemap is a music-timeline-based formation editor for choreography teams.

The core value is:

- Choreographers can create and revise formations quickly while listening to music.
- Team members can understand the formations and transitions easily from a shared link.

Movemap should feel like a focused editing tool, not a broad desktop suite. The product should borrow the clarity of video-editing timelines, while keeping the visible menu surface small.

## Primary User Scenario

1. The user loads a song.
2. The user plays the song and listens for formation change points.
3. At the moment a new formation is needed, the user presses `+ Formation`.
4. The new formation is created at the current playback time.
5. If a previous formation exists, the new formation starts as a copy of the previous formation.
6. The user edits only the changed performers or groups.
7. The user repeats this process through the song.
8. The user shares the result with team members, who can review it without needing to edit.

This means formation creation must be optimized for repeated, music-driven editing. Users should not need to rebuild each formation from scratch.

## Core Editing Principles

- `+ Formation` should create a formation at the current music time.
- New formations should default to copying the previous formation.
- The newly created formation should become selected immediately.
- Formation blocks should be editable on the timeline.
- Users should be able to move, duplicate, delete, and retime formations quickly.
- Performer editing should support fast changes, not only one-by-one adjustments.
- Shared views should explain the choreography clearly without exposing editing complexity.

## Interface Direction

The main editor should be organized around three persistent areas:

- Center stage canvas
- Bottom music and formation timeline
- Contextual detail panel for the selected item

The product should avoid a large always-visible menu system. Instead, controls should appear based on the selected object:

- Performer selected: name, color, part/group, pair/partner, remove
- Formation selected: arrival time, movement duration, memo, duplicate, delete
- Transition selected: movement paths, performer filters, preview controls
- Nothing selected: project summary and primary actions

## Bottom Timeline

The bottom timeline is the center of the workflow.

Required timeline concepts:

- Audio waveform
- Playback head
- Time ruler
- Formation blocks such as `F1`, `F2`, `F3`
- `+ Formation` action near the timeline
- Click formation block to select it
- Drag formation block to change arrival time
- Show the segment between two formations as the movement interval
- Previous and next formation navigation
- Zoom or horizontal scrolling for longer songs

The timeline should feel closer to a focused video editor than a form-based planner.

## Stage Canvas

The stage canvas should make position and movement easy to read.

Important capabilities:

- Clear stage grid
- Stage direction labels
- Strong selected performer state
- Movement path display between previous and current formation
- Highlight selected performer's path
- Optional part/group path filtering
- Multi-select performer movement
- Alignment tools such as horizontal align, vertical align, distribute spacing, and center

## Functional Upgrade Priorities

### Phase 1: Fast Formation Creation

- Current-time formation creation
- Previous-formation copy when adding a new formation
- Immediate selection of the new formation
- Formation duplicate
- Formation delete
- Arrival time editing
- Movement duration editing

### Phase 2: Fast Formation Revision

- Multi-select performers
- Move selected performers together
- Select by part/group
- Align selected performers
- Distribute selected performers
- Restore selected performers to previous formation positions
- Improve undo/redo reliability for formation edits

### Phase 3: Transition Understanding

- Show movement paths from previous formation to current formation
- Highlight selected performer movement
- Filter paths by performer or part/group
- Show long-distance or rushed movements
- Preview the transition interval

### Phase 4: Team Sharing

- View-only share link
- Shared playback with music
- Current formation and next formation display
- Mobile-friendly shared view
- Performer name and part/group visibility
- Selected performer-only review mode

## Plan Model

The plan model should support guest use, free Google login, and paid plans.

### Guest

- Local editing
- Local browser persistence
- JSON import/export
- Basic PNG/PDF export
- No cloud projects
- No share links

### Free Google Login

- Cloud project limit: 2 projects
- Share links allowed for saved projects
- One audio file per project
- Basic PNG/PDF export
- Guest project can be saved into the account
- No advanced share-link management

Free users should be able to experience the full core workflow, including sharing. The upgrade pressure should come from project limits and management needs, not from blocking the first useful share.

### Paid Team-Oriented Plan

- Expanded or unlimited projects
- Larger audio storage
- Share link management
- Project duplication and templates
- Version history
- Advanced export
- Team or class workspace
- Member permissions
- Comments and feedback

## App Packaging Direction

Movemap should remain web-first, but the architecture should allow app packaging later.

Recommended direction:

- Build a strong mobile web/PWA experience first.
- Keep sharing link-based so team members can view without installing an app.
- Package the editor with Capacitor or a similar webview-based app shell when needed.
- Avoid a full native rewrite until the editing model is stable.

Browser-specific features such as file access, audio handling, sharing, and authentication should be isolated behind small interfaces so they can be adapted for an app shell later.

## Competitive Reference

Sway Formations shows that a formation editor can feel professional when it has:

- A strong stage canvas
- A bottom timeline with audio and formation blocks
- Contextual editing panels
- Mobile review for team members
- Team-oriented pricing

Movemap should not copy Sway's full menu density. Movemap's differentiation should be a simpler Korean-friendly workflow centered on:

- Load music
- Add formation at the current time
- Copy the previous formation
- Quickly revise changes
- Share a clear review link

## Non-Goals For The Next Spec

- Full native app rewrite
- Complex desktop-style menu system
- 3D editor
- Realtime collaborative editing
- Automatic beat analysis
- Video export
- Full team workspace implementation

These can remain future paid-plan candidates, but they should not block the first fast-editing workflow upgrade.
