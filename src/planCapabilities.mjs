export const PLAN_TYPES = Object.freeze({
  guest: "guest",
  free: "free",
  pro: "pro",
  team: "team"
});

export const FREE_CLOUD_PROJECT_LIMIT = 3;
export const PRO_CLOUD_PROJECT_LIMIT = 50;

export const TEAM_ROLES = Object.freeze({
  owner: "owner",
  admin: "admin",
  editor: "editor",
  viewer: "viewer"
});

const FREE_LIMITS = Object.freeze({
  cloudProjects: FREE_CLOUD_PROJECT_LIMIT,
  audioFilesPerProject: 1,
  viewLinks: 1,
  editLinks: 1,
  exportsPerProject: Infinity,
  snapshotsPerProject: 3,
  aiProposalsPerMonth: 5,
  teamMembers: 1
});

export const PRO_LIMITS = Object.freeze({
  cloudProjects: PRO_CLOUD_PROJECT_LIMIT,
  audioFilesPerProject: 20,
  viewLinks: Infinity,
  editLinks: Infinity,
  exportsPerProject: Infinity,
  snapshotsPerProject: 100,
  aiProposalsPerMonth: 250,
  teamMembers: 1
});

export const TEAM_LIMITS = Object.freeze({
  cloudProjects: Infinity,
  audioFilesPerProject: Infinity,
  viewLinks: Infinity,
  editLinks: Infinity,
  exportsPerProject: Infinity,
  snapshotsPerProject: Infinity,
  aiProposalsPerMonth: Infinity,
  teamMembers: Infinity
});

const GUEST_LIMITS = Object.freeze({
  cloudProjects: 0,
  audioFilesPerProject: 0,
  viewLinks: 0,
  editLinks: 0,
  exportsPerProject: 1,
  snapshotsPerProject: 0,
  aiProposalsPerMonth: 0,
  teamMembers: 0
});

const BILLING_STATES = new Set(["inactive", "trialing", "active", "past_due", "canceled", "unknown"]);

export function planCapabilities(planType = PLAN_TYPES.guest) {
  const type = Object.values(PLAN_TYPES).includes(planType) ? planType : PLAN_TYPES.guest;
  if (type === PLAN_TYPES.guest) {
    return {
      type,
      demoOnly: true,
      billingRequired: false,
      billingState: "inactive",
      teamWorkspace: false,
      teamRoles: [],
      limits: GUEST_LIMITS
    };
  }
  const billingRequired = type === PLAN_TYPES.pro || type === PLAN_TYPES.team;
  return {
    type,
    demoOnly: false,
    billingRequired,
    billingState: billingRequired ? "active" : "inactive",
    teamWorkspace: type === PLAN_TYPES.team,
    teamRoles: type === PLAN_TYPES.team ? Object.values(TEAM_ROLES) : [],
    limits: type === PLAN_TYPES.free ? FREE_LIMITS : type === PLAN_TYPES.pro ? PRO_LIMITS : TEAM_LIMITS
  };
}

export function canOwnCloudProject(capabilities) {
  return Boolean(capabilities && !capabilities.demoOnly && capabilities.limits?.cloudProjects > 0);
}

export function canCreateLink(capabilities, linkType, existingCount = 0) {
  if (!canOwnCloudProject(capabilities)) return false;
  const limitKey = linkType === "edit" ? "editLinks" : "viewLinks";
  return existingCount < (capabilities.limits?.[limitKey] || 0);
}

export function canUseAiProposal(capabilities, usedCount = 0) {
  if (!canOwnCloudProject(capabilities)) return false;
  return usedCount < (capabilities.limits?.aiProposalsPerMonth || 0);
}

export function canExportProject(capabilities, usedCount = 0) {
  const limit = capabilities?.limits?.exportsPerProject ?? 0;
  return limit === Infinity || usedCount < limit;
}

export function canUseTeamWorkspace(capabilities, role = TEAM_ROLES.viewer) {
  return Boolean(capabilities?.teamWorkspace && capabilities.teamRoles?.includes(role));
}

export function normalizeBillingState(input = {}) {
  const status = typeof input === "string" ? input : input.status;
  const normalized = String(status || "unknown").toLowerCase().replaceAll("-", "_");
  const state = BILLING_STATES.has(normalized) ? normalized : "unknown";
  return {
    state,
    active: state === "active" || state === "trialing",
    pastDue: state === "past_due",
    canceled: state === "canceled",
    provider: typeof input === "object" && input.provider ? String(input.provider) : ""
  };
}
