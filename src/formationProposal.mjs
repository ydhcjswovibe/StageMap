function performerIds(performers = []) {
  return performers.map((performer) => performer?.id).filter(Boolean);
}

function clonePositions(positions = {}) {
  return Object.fromEntries(
    Object.entries(positions).map(([id, position]) => [id, { x: position.x, y: position.y }])
  );
}

function proposalPositionEntries(proposal = {}) {
  return Object.entries(proposal?.positions || {});
}

function provenanceForProposal(proposal = {}, positions = {}, extra = {}) {
  return {
    kind: "proposal",
    ...extra,
    performerCount: Object.keys(positions).length,
    ...(proposal.source ? { source: proposal.source } : {})
  };
}

export function validateFormationProposal(proposal = {}, performers = [], options = {}) {
  const ids = performerIds(performers);
  const knownIds = new Set(ids);
  const entries = proposalPositionEntries(proposal);
  const errors = [];

  for (const [id, position] of entries) {
    if (!knownIds.has(id)) {
      errors.push({ code: "unknown-performer", performerId: id });
      continue;
    }

    for (const axis of ["x", "y"]) {
      const value = position?.[axis];
      if (!Number.isFinite(value)) {
        errors.push({ code: "non-finite-coordinate", performerId: id, axis });
      } else if (value < 0 || value > 100) {
        errors.push({ code: "out-of-bounds-coordinate", performerId: id, axis, value });
      }
    }
  }

  if (options.requireAllPerformers) {
    const proposedIds = new Set(entries.map(([id]) => id));
    for (const id of ids) {
      if (!proposedIds.has(id)) {
        errors.push({ code: "missing-performer", performerId: id });
      }
    }
  }

  if (errors.length) {
    return { ok: false, positions: {}, errors };
  }

  return { ok: true, positions: clonePositions(proposal.positions || {}), errors: [] };
}

export function applyProposalPositionsToSection(section = {}, validation = {}, provenance = {}) {
  const positions = validation.positions || {};
  return {
    ...section,
    positions: {
      ...(section.positions || {}),
      ...clonePositions(positions)
    },
    formationProvenance: provenanceForProposal({}, positions, provenance)
  };
}

export function acceptFormationProposal(section = {}, proposal = {}, performers = [], options = {}) {
  const validation = validateFormationProposal(proposal, performers, options);
  if (!validation.ok) {
    return { ok: false, section, positions: {}, errors: validation.errors };
  }

  return {
    ok: true,
    section: {
      ...section,
      positions: {
        ...(section.positions || {}),
        ...clonePositions(validation.positions)
      },
      formationProvenance: provenanceForProposal(proposal, validation.positions)
    },
    positions: validation.positions,
    errors: []
  };
}
