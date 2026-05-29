import assert from "node:assert/strict";
import test from "node:test";

import {
  PLAN_TYPES,
  FREE_CLOUD_PROJECT_LIMIT,
  PRO_CLOUD_PROJECT_LIMIT,
  TEAM_ROLES,
  PRO_LIMITS,
  planCapabilities,
  canCreateLink,
  canOwnCloudProject,
  canExportProject,
  canUseAiProposal,
  canUseTeamWorkspace,
  normalizeBillingState
} from "./planCapabilities.mjs";

test("guest is demo-only and cannot own cloud projects or links", () => {
  const guest = planCapabilities(PLAN_TYPES.guest);

  assert.equal(guest.demoOnly, true);
  assert.equal(canOwnCloudProject(guest), false);
  assert.equal(canCreateLink(guest, "view", 0), false);
});

test("free plan centralizes MVP limits for projects, audio, and links", () => {
  const free = planCapabilities("free");

  assert.equal(free.limits.cloudProjects, FREE_CLOUD_PROJECT_LIMIT);
  assert.equal(free.limits.audioFilesPerProject, 1);
  assert.equal(free.limits.viewLinks, 1);
  assert.equal(free.limits.editLinks, 1);
  assert.equal(free.limits.aiProposalsPerMonth, 5);
  assert.equal(free.limits.snapshotsPerProject, 3);
  assert.equal(canCreateLink(free, "view", 0), true);
  assert.equal(canCreateLink(free, "view", 1), false);
  assert.equal(canUseAiProposal(free, 4), true);
  assert.equal(canUseAiProposal(free, 5), false);
});

test("pro and team expose explicit limits behind the plan interface", () => {
  const pro = planCapabilities("pro");
  const team = planCapabilities("team");

  assert.equal(pro.billingRequired, true);
  assert.equal(pro.limits.cloudProjects, PRO_CLOUD_PROJECT_LIMIT);
  assert.equal(pro.limits.audioFilesPerProject, PRO_LIMITS.audioFilesPerProject);
  assert.equal(canExportProject(pro, 999), true);
  assert.equal(team.billingRequired, true);
  assert.equal(team.teamWorkspace, true);
  assert.equal(team.limits.teamMembers, Infinity);
});

test("billing state normalization is provider-neutral", () => {
  assert.deepEqual(normalizeBillingState({ status: "trialing", provider: "stripe" }), {
    state: "trialing",
    active: true,
    pastDue: false,
    canceled: false,
    provider: "stripe"
  });
  assert.equal(normalizeBillingState("past-due").pastDue, true);
  assert.equal(normalizeBillingState("nonsense").state, "unknown");
});

test("team roles are placeholders without enabling team UI for non-team plans", () => {
  assert.equal(canUseTeamWorkspace(planCapabilities("free"), TEAM_ROLES.editor), false);
  assert.equal(canUseTeamWorkspace(planCapabilities("team"), TEAM_ROLES.editor), true);
  assert.equal(canUseTeamWorkspace(planCapabilities("team"), "billing-owner"), false);
});
