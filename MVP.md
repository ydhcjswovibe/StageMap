# Movemap MVP Implementation Plan

## Purpose

`SPEC.md` is the canonical product contract. `MVP.md` translates that SPEC into implementation stages that can be executed directly.

This file should answer:

- which SPEC features belong to the full MVP
- which stage each feature belongs to
- what is already implemented
- what the next build slice should do
- what is explicitly outside the SPEC/MVP

Important distinction:

- **Full MVP** means the SPEC-defined product loop is usable end to end.
- **Current implementation wave** means the subset we are building right now.

The full MVP is larger than the current implementation wave. Features such as login-backed ownership, mobile full editing, 3D preview, templates, and bounded AI are still MVP features, but they are later stages.

## Full MVP Product Loop

The MVP should prove this practical loop:

1. A user can open Movemap without login and try the editor in demo mode.
2. The user can sign in to create a durable project.
3. The user can load music.
4. The user can create, duplicate, delete, time, and revise formations.
5. The user can understand transitions in 2D and basic 3D preview.
6. The user can use deterministic templates to start faster.
7. The user can ask bounded AI for formation ideas and then manually accept/edit them.
8. The user can share View Links and Edit Links.
9. Mobile users can review and perform practical field edits from a touch-native surface.
10. Free/Pro/Team boundaries exist clearly enough to support paid growth later.

## Full MVP Release Gates

The full MVP is releasable only when these gates pass as browser/manual scenarios, with required automated coverage where practical:

| Gate | Manual scenario | Required automated coverage | Notes |
| --- | --- | --- | --- |
| Guest demo flow | User opens Movemap without login and tries local editing. | Browser smoke for guest editor load and unit/route coverage for blocked durable save/share. | Guest mode stays demo-only. |
| Signed-in Free flow | User signs in, creates a project, saves, uploads music where allowed, shares links, and hits Free limits. | Unit/route coverage for persisted owner records, cloud save authorization, upload permission, share creation, and Free limit enforcement. | Limits cannot rely only on client state. |
| Core formation/timeline edit flow | User creates, duplicates, deletes, reorders, times, and reviews formations. | Unit coverage for formation/timeline mutations and browser smoke for the primary editing loop. | Arrival/movement semantics must not be corrupted. |
| Mobile field-edit flow | Phone user performs practical stage, roster, timeline, timing, transition, and share edits from touch-native controls. | Mobile viewport browser coverage for editor mobile viewport and edit-link recipient mobile viewport. | Mobile is part of MVP, not a follow-up platform. |
| View Link and Edit Link flow | View Link opens review without login or edit controls; Edit Link authorizes recipient editing by link capability. | Unit/route coverage for disabled View Link, invalid/disabled Edit Link readonly fallback, and edit-control suppression; browser smoke for public access. | Disabled View Link hides project content behind a disabled notice. |
| 2D and basic 3D transition preview flow | User understands movement in canonical 2D and read-only 3D preview. | Unit coverage for shared preview data and browser smoke for editor/review preview access. | 3D never becomes a second source of truth. |
| Templates flow | User selects/applies deterministic templates, adapts them to roster count, and continues editing. | Unit coverage for deterministic template adaptation and browser smoke for template selection/application. | Template output remains editable. |
| Bounded AI flow | User requests a formation proposal, previews validated output, accepts or rejects it explicitly, and can continue editing after AI failure. | Unit coverage for proposal validation, accept/reject behavior, failure handling, and plan usage limits. | AI proposes; Movemap validates; user applies. |

Mobile acceptance uses these shared verification surfaces:

- editor mobile viewport
- shared review mobile viewport
- edit-link recipient mobile viewport
- export/readable mobile view

## Status Legend

- `Done`: Implemented and verified in the current app.
- `Partial`: Some behavior exists, but the stage is not complete.
- `Not started`: No meaningful implementation yet.
- `Blocked`: Needs an external dependency or earlier stage.
- `Out`: Explicitly outside the MVP/SPEC.

## Stage Map

### Stage 0: Foundation Already Built

Status: `Done` / `Partial`

Goal: Make the existing 2D editor usable enough to support route, account, mobile, and future feature work.

Implemented:

- Music-timed formation creation.
- Arrival time, movement start, and movement duration model.
- Bottom timeline/formation rail foundation.
- Formation duplicate/delete foundation.
- Pair/partner movement foundation.
- Pointer-event stage dragging.
- Shared route loading through Supabase project rows.
- View Link and Edit Link URL/token foundation.
- MVP owner-session link management.
- Long-distance transition warnings.
- Mobile route smoke and mobile action bar foundation.
- Browser route/cloud/mobile Playwright harness.

Last verified for Stage 0 owner-session/share/mobile slice on 2026-05-29:

- `npm test`
- `npm run build`
- `npm run test:browser`
- `git diff --check`

Remaining in this stage:

- Keep regression tests green while later stages replace owner-session with real auth.

### Stage 1: Auth, Ownership, Free Limits, And Share Security

Status: `Partial` / `Implemented locally`

SPEC source:

- Durable creation, save, upload, share, and AI require login.
- Guest mode is demo-only.
- View Links open without login and cannot edit.
- Edit Links open without login but authorize editing by link capability.
- Paid value comes from storage, management, AI usage, and teams.

Current implementation:

- Guest/new local projects exist.
- Google OAuth sign-in/sign-out UI exists through Supabase Auth.
- Guest durable cloud save, upload, and share attempts are blocked until sign-in.
- Authenticated cloud save/share sends owner bearer token and persists `owner.userId`.
- Project rows mirror `account_plan`, `view_enabled`, `edit_enabled`, and `edit_token` outside project JSON.
- View Link remains public readonly when enabled.
- Edit Link recipient loading and saving use token-gated RPC helpers.
- Disabled View Link shows only disabled-link status and does not render project content.
- Supabase setup docs and `docs/supabase/stage1-auth-ownership.sql` define owner RLS, public View Link read, Edit Link RPCs, authenticated audio upload, and server-side Free project limit trigger.
- `docs/supabase/stage1-verification.md` defines SQL, Google OAuth, link, and Free limit smoke checks for the real Supabase project.
- Legacy `owner-session` helper tests remain for compatibility but it is no longer authoritative for Stage 1 cloud ownership.
- `account.plan` supports `guest`, `free`, `pro`, and `team` as helper state.

Verified on 2026-05-29:

- `npm test`
- `npm run build`
- `npm run test:browser`
- `git diff --check`

Remaining implementation slices:

1. Apply and verify the documented SQL/RLS/RPC policy in the real Supabase project.
2. Add live Google OAuth manual smoke against production/staging Supabase provider settings.
3. Add authenticated browser fixture coverage once the test harness can seed a Supabase Auth session.

Acceptance criteria:

- Guest can try the editor locally.
- Guest cannot create durable cloud projects or share links without sign-in.
- Signed-in Free user can create the allowed number of cloud projects.
- Signed-in Free user cannot bypass Free project/link limits by changing client state.
- Non-owner cannot manage project links.
- Disabled View Link shows only a disabled-link notice and does not expose project content as active review.
- Invalid/disabled Edit Link may fall back to readonly review where allowed, but never exposes edit controls.
- Existing public share links remain browser-accessible where allowed.

### Stage 2: Core Formation And Timeline Completion

Status: `Partial`

SPEC source:

- Formation editing is the primary object model.
- Timeline is the time-based home for formations and transitions.
- Paired movement behavior should be preserved.
- Transition visualization can initially use straight-line interpolation.

Current implementation:

- Formation creation follows captured playback time.
- `대형 추가` means arrival formation.
- Timeline blocks show arrival/movement spans.
- Duplicate selects the new copy.
- Delete refuses the last section and selects a nearby section.
- Multi-select and simple role selection/alignment exist.
- Long-distance transition warnings render in editor and shared review.

Next implementation slices:

1. Tighten timeline ruler/playhead/waveform polish where visual regressions appear.
2. Add explicit transition-review mode for selected section.
3. Add better path filtering for group/role/selected performer.
4. Add collision/overlap warning display, not auto-fix.
5. Add tests for pair behavior across duplicate/delete/timeline reorder.

Acceptance criteria:

- Choreographer can build a full song-length formation sequence.
- Timeline edits do not corrupt arrival/movement semantics.
- Pair/partner behavior survives section edits.
- Transition warnings are visible in editor and shared review.
- Shared review communicates movement clearly without exposing edit complexity.

### Stage 3: Mobile Full Editing

Status: `Partial`

SPEC source:

- Desktop and mobile are both first-class editing surfaces.
- Mobile editing should be touch-native, not a shrunken desktop interface.
- Mobile supports stage editing, roster edits, timeline formation selection, timing changes, transition review, 3D preview, AI generation, and sharing.

Current implementation:

- Mobile viewport can drag performers.
- Mobile shared review route loads.
- Mobile action bar exposes select/add/duplicate/delete/undo/share.
- Mobile bottom sheet can show existing tool panels.

Next implementation slices:

1. Replace the desktop-density mobile sheet with task-specific mobile tabs.
2. Add mobile formation selector with clear current/selected states.
3. Add mobile timing controls for arrival and movement duration.
4. Add mobile roster edit flow.
5. Add route-specific Edit Link onboarding for mobile recipients.
6. Add mobile transition review.

Acceptance criteria:

- A phone user can make practical rehearsal edits without desktop.
- Mobile controls do not overlap or require desktop-style precision.
- Mobile timeline navigation can select and inspect formations.
- Mobile can save/share according to account/link permissions.

### Stage 4: Stage Reference

Status: `Implemented locally`

SPEC source:

- Stage Reference is support context for editor, mobile, review, and export surfaces.
- Stage Reference belongs to canonical 2D context before optional 3D preview.
- Stage Reference should not compete with performer movement as the primary edit target.

Next implementation slices:

1. Done: fixed Stage Reference marks are normalized in project JSON and rendered behind performers.
2. Done: Stage Reference appears in editor and exported readable SVG/PNG/PDF paths.
3. Done: performer selection and movement remain the dominant editing interaction.
4. Done: visibility and label controls are local view controls.
5. Remaining: add broader browser coverage for shared/mobile reference rendering.

Acceptance criteria:

- Stage Reference is visible in editor, mobile, shared review, and export/readable views.
- Stage Reference provides context without becoming the primary movement edit target.
- Stage Reference remains tied to canonical 2D coordinates and does not depend on 3D preview.

### Stage 5: Basic 3D Preview

Status: `Implemented locally`

SPEC source:

- 3D is a preview surface, not the canonical editor.
- 3D preview should be available in Free.
- 3D helps users understand movement and should not be the primary Pro paywall.

Next implementation slices:

1. Done: Three.js read-only 3D preview is derived from canonical 2D positions.
2. Done: editing remains in 2D; 3D is preview-only.
3. Partial: angled camera preview exists; additional presets can follow.
4. Partial: transition samples render as read-only path lines.
5. Remaining: broaden shared-review/mobile-specific browser coverage.

Acceptance criteria:

- 3D preview reflects the same canonical 2D formation/timeline data.
- 3D preview works in editor, mobile editor/review, and shared review.
- 3D does not introduce a second source of truth.

### Stage 6: Deterministic Templates

Status: `Implemented locally`

SPEC source:

- Templates are included.
- Initial templates should be local and deterministic.
- Templates should adapt to roster count.

Next implementation slices:

1. Done: local deterministic line, two-line, V, circle, diagonal, and block templates exist.
2. Done: templates adapt to current roster count.
3. Remaining: saving personal local templates.
4. Done: template provenance is stored on applied formations.
5. Done: deterministic adaptation tests cover bounds and mutation safety.

Acceptance criteria:

- User can create a useful starting formation without AI.
- Template output is deterministic and editable.
- Templates work with different roster sizes.
- Mobile users can preview/select templates, and apply them where mobile editing permissions allow.

### Stage 7: Bounded AI Formation Generation

Status: `Implemented locally` / `Provider pending`

SPEC source:

- AI formation generation is included, but bounded.
- AI proposes, Movemap validates, and the user applies.
- The core editor must remain useful without AI.

Next implementation slices:

1. Done locally: proposal interface uses bounded candidate objects only.
2. Done: proposals validate roster ids, required performers, finite coordinates, and stage bounds.
3. Done: user previews and explicitly accepts/rejects before mutation.
4. Done: accepted proposals write provenance.
5. Done locally: AI proposal limits are represented in plan capabilities.
6. Remaining: connect a real AI provider behind this validated proposal seam.

Acceptance criteria:

- AI cannot directly corrupt canonical project data.
- User explicitly accepts or rejects AI output.
- AI failure leaves the editor fully usable.
- Mobile users can request, preview, accept, and reject proposals without breaking the editor flow.

### Stage 8: Pro, Billing, And Team Foundations

Status: `Implemented locally` / `Provider pending`

SPEC source:

- Guest demo, Free, Pro, Team/Studio, and Enterprise/School plans.
- Team features should be possible later without forcing account complexity into the first editing flow.
- Paid value comes from scale, storage, management, AI usage, and team operations.

Current implementation:

- Plan helper represents Guest, Free, Pro, and Team.
- Free limit representation moves to real enforcement in Stage 1.
- Pro and Team now have explicit named limits for projects, audio, links, exports, snapshots, AI proposals, and team members.
- Billing state normalization is provider-neutral and ready for a billing adapter.
- Team role placeholders exist without exposing team complexity in the first editing flow.

Next implementation slices:

1. Done: Pro limit model sits on top of Stage 1 account ownership.
2. Partial: billing provider seam exists; live provider adapter remains.
3. Remaining: plan upgrade/downgrade handling with a real provider.
4. Done: Team role placeholders exist.
5. Remaining: Team workspace/member persistence and enforcement.

Acceptance criteria:

- Stage 1 Free limits remain enforced after Pro/Billing additions.
- Pro/Team concepts do not leak complexity into first editing flow.
- Billing can be added without rewriting project ownership.

### Stage 9: Export, Packaging, And Hardening

Status: `Implemented locally`

SPEC source:

- Projects should remain portable through JSON export/import where plan allows export.
- Shared review should explain choreography without exposing editing complexity.
- App packaging should remain possible later.

Current implementation:

- JSON export/import exists.
- PNG and print/PDF fallback exist.
- Browser app works locally.
- Import validation now returns structured, user-readable errors.
- JSON export can include snapshot metadata while keeping projects portable.
- Advanced exports are plan-gated while basic JSON recovery remains available.

Next implementation slices:

1. Done: import/export validation is hardened.
2. Done locally: snapshot metadata is attached to manual JSON export.
3. Partial: existing review/export layout remains readable; deeper visual QA is still useful.
4. Remaining: native app packaging as a later platform step.

Acceptance criteria:

- Users can recover their work through portable exports.
- Shared/exported views are readable without editor-only controls.
- Mobile shared review remains readable and export actions stay discoverable where the plan allows export.

## Explicitly Out Of MVP

These are outside the MVP unless SPEC changes:

- 3D editing as a canonical authoring surface.
- 3D prop modeling.
- Full DAW or video-editor behavior.
- Multi-user realtime editing.
- Automated choreography correctness scoring.
- Enterprise school administration workflows.

## Current Next Step

The next highest-leverage stage is **Stage 1: Auth, Ownership, Free Limits, And Share Security**.

Reason:

- It turns the current owner-session MVP into the SPEC-required durable login/share model.
- It is a prerequisite for real Free limits, AI usage limits, Team ownership, and trusted link management.
- It reduces the largest gap between the current implementation and the full SPEC MVP.

Recommended next slice:

1. Add Supabase Auth sign-in/sign-out UI.
2. Attach authenticated owner id to saved cloud projects.
3. Require owner auth for cloud save/share/link management.
4. Preserve no-login View Link and Edit Link recipient access.
5. Add route and unit tests for owner/non-owner behavior.

## Documentation Flow

When a stage is completed:

1. Move implemented behavior into that stage's `Current implementation` list.
2. Mark the stage `Done` only when its acceptance criteria are test-covered.
3. Keep later SPEC items in their staged section, not in a vague backlog.
4. If a feature is intentionally removed from MVP, update both `SPEC.md` and this file.
