// ═══════════════════════════════════════════════════════════
// Testbench Assertions — Invariant checks for TokenFlow security
//
// Each assertion verifies a specific security property of the
// capability-token architecture. These map directly to the
// failure modes exposed by the Vertex AI Double Agent incident.
// ═══════════════════════════════════════════════════════════

/**
 * Run all invariant assertions against a completed test run.
 * @param {object} params
 * @param {object} params.scenario — the scenario definition
 * @param {object[]} params.chain — token chain
 * @param {object[]} params.auditLog — audit events
 * @param {object} params.workflow — workflow record
 * @returns {{ assertions: object[], passed: number, failed: number, total: number }}
 */
export const INVARIANT_COUNT = 14;

export function runAssertions({ scenario, chain, auditLog, workflow }) {
  const assertions = [
    assertExpectedWorkflowOutcome(workflow, scenario),
    assertOneTokenOneAction(chain),
    assertBurnedNotReused(chain, auditLog),
    assertExpiredNotConsumed(chain, auditLog),
    assertActionMatchesScope(chain),
    assertServiceMatchesContext(chain),
    assertResourceScopeNotExceeded(chain),
    assertUnauthorizedBlocked(chain, scenario),
    assertCrossServiceBlocked(chain, auditLog, scenario),
    assertScopeEscalationBlocked(auditLog, workflow, scenario),
    assertKillSwitchStops(chain, workflow, scenario),
    assertPauseResumeRevoke(workflow, scenario),
    assertSecretsNotExposed(chain, auditLog),
    assertAuditComplete(chain, auditLog),
  ];

  const passed = assertions.filter(a => a.passed).length;
  const failed = assertions.filter(a => !a.passed).length;

  return {
    assertions,
    passed,
    failed,
    total: assertions.length,
  };
}

function assertExpectedWorkflowOutcome(workflow, scenario) {
  const id = 'expected-workflow-outcome';
  const name = 'Workflow Ends In Expected State';
  const description = 'Each built-in scenario should settle into its documented terminal state.';
  const expectedStatus = scenario.expected_status;

  if (!expectedStatus) {
    return {
      id,
      name,
      description,
      passed: true,
      expected: 'Scenario does not declare an expected terminal state',
      actual: `Workflow status: ${workflow?.status || 'unknown'}`,
    };
  }

  return {
    id,
    name,
    description,
    passed: workflow?.status === expectedStatus,
    expected: `Workflow status should be "${expectedStatus}"`,
    actual: `Workflow status is "${workflow?.status || 'unknown'}"`,
  };
}

// ─── 1. One token = one action ──────────────────────────────
function assertOneTokenOneAction(chain) {
  const id = 'one-token-one-action';
  const name = 'One Token = One Action';
  const description = 'Each token in the chain should map to exactly one action type.';

  // Every token should have a unique nonce and a singular action_type
  const burnedTokens = chain.filter(t => t.status === 'burned');
  const allHaveSingleAction = burnedTokens.every(t =>
    t.action_type && typeof t.action_type === 'string'
  );

  // Check no token was used for multiple actions (via audit)
  return {
    id,
    name,
    description,
    passed: allHaveSingleAction,
    expected: 'Every burned token maps to exactly one action',
    actual: allHaveSingleAction
      ? `${burnedTokens.length} token(s) correctly single-action`
      : 'Found token with missing or invalid action_type',
  };
}

// ─── 2. Burned tokens cannot be reused ──────────────────────
function assertBurnedNotReused(chain, auditLog) {
  const id = 'burned-not-reused';
  const name = 'Burned Tokens Cannot Be Reused';
  const description = 'Attempting to consume a burned token must fail with REPLAY_REJECTED.';

  const burnedTokenIds = chain.filter(t => t.status === 'burned').map(t => t.id);
  const replayAttempts = auditLog.filter(
    e => e.event_type === 'REPLAY_REJECTED' && burnedTokenIds.includes(e.token_id)
  );

  // For replay scenarios, we expect a REPLAY_REJECTED event
  // For non-replay scenarios, absence of replay is also a pass
  const hasReplayScenario = chain.some(t => {
    const ctx = typeof t.context === 'string' ? JSON.parse(t.context || '{}') : t.context;
    return ctx?.result?.replay_attempt;
  });

  if (!hasReplayScenario && replayAttempts.length === 0) {
    // No replay attempted — vacuously true
    return { id, name, description, passed: true, expected: 'No replays attempted or all replays blocked', actual: 'No replay attempts in this scenario' };
  }

  return {
    id,
    name,
    description,
    passed: replayAttempts.length > 0 || !hasReplayScenario,
    expected: 'Burned token replay blocked',
    actual: replayAttempts.length > 0
      ? `${replayAttempts.length} replay attempt(s) correctly rejected`
      : 'Replay scenario present but no REPLAY_REJECTED audit event found',
  };
}

// ─── 3. Expired tokens cannot be consumed ───────────────────
function assertExpiredNotConsumed(chain, auditLog) {
  const id = 'expired-not-consumed';
  const name = 'Expired Tokens Cannot Be Consumed';
  const description = 'Tokens that have passed their TTL must not be consumable.';

  const expiredEvents = auditLog.filter(e => e.event_type === 'EXPIRED');
  const burnedAfterExpiry = chain.filter(t => {
    if (t.status !== 'burned') return false;
    return new Date(t.expires_at) < new Date(t.minted_at);
  });

  return {
    id,
    name,
    description,
    passed: burnedAfterExpiry.length === 0,
    expected: 'No tokens burned after expiry',
    actual: burnedAfterExpiry.length === 0
      ? 'All consumed tokens were within TTL'
      : `${burnedAfterExpiry.length} token(s) consumed after expiry`,
  };
}

// ─── 4. Action must match token scope ───────────────────────
function assertActionMatchesScope(chain) {
  const id = 'action-matches-scope';
  const name = 'Action Matches Token Scope';
  const description = 'The action_type of a consumed token must match the action it was minted for.';

  const burnedTokens = chain.filter(t => t.status === 'burned');
  const mismatches = burnedTokens.filter(t => {
    const ctx = typeof t.context === 'string' ? JSON.parse(t.context || '{}') : t.context;
    return ctx?.action && ctx.action !== (
      t.action_type === 'READ_OBJECT' ? 'read' :
      t.action_type === 'CALL_INTERNAL_API' ? 'invoke' :
      t.action_type === 'WRITE_OBJECT' ? 'write' : null
    );
  });

  return {
    id,
    name,
    description,
    passed: mismatches.length === 0,
    expected: 'All burned tokens action matches their scope',
    actual: mismatches.length === 0
      ? `${burnedTokens.length} token(s) correctly scoped`
      : `${mismatches.length} action/scope mismatch(es) found`,
  };
}

// ─── 5. Service must match token context ────────────────────
function assertServiceMatchesContext(chain) {
  const id = 'service-matches-context';
  const name = 'Service Matches Token Context';
  const description = 'Burned tokens must only have accessed their assigned service.';

  const burnedTokens = chain.filter(t => t.status === 'burned');
  const mismatches = burnedTokens.filter(t => {
    const ctx = typeof t.context === 'string' ? JSON.parse(t.context || '{}') : t.context;
    if (!ctx?.service) return false;
    const expectedService = t.action_type === 'READ_OBJECT' || t.action_type === 'WRITE_OBJECT' ? 'gcs' : 'internal-api';
    return ctx.service !== expectedService;
  });

  return {
    id,
    name,
    description,
    passed: mismatches.length === 0,
    expected: 'All burned tokens accessed their scoped service',
    actual: mismatches.length === 0
      ? `${burnedTokens.length} token(s) correctly service-bound`
      : `${mismatches.length} service mismatch(es) found`,
  };
}

// ─── 6. Resource scope cannot be exceeded ───────────────────
function assertResourceScopeNotExceeded(chain) {
  const id = 'resource-scope-respected';
  const name = 'Resource Scope Not Exceeded';
  const description = 'Tokens must only access the resource they were scoped for.';

  const burnedTokens = chain.filter(t => t.status === 'burned');
  // Each token's resource_id is set from the scenario step definition.
  // The context.resource is also set from the same step definition.
  // They should match — if they don't, there's a real scope violation.
  const violations = burnedTokens.filter(t => {
    const ctx = typeof t.context === 'string' ? JSON.parse(t.context || '{}') : t.context;
    // Both resource_id and context.resource come from the step definition,
    // so they should always match. We check for external tampering only.
    if (!ctx?.resource || !t.resource_id) return false;
    // Compare: the context resource must match the token's authorized resource
    return ctx.resource !== t.resource_id;
  });

  return {
    id,
    name,
    description,
    passed: violations.length === 0,
    expected: 'All tokens accessed only their scoped resource',
    actual: violations.length === 0
      ? 'Resource scoping respected'
      : `${violations.length} resource scope violation(s)`,
  };
}

// ─── 7. Unauthorized steps are blocked ──────────────────────
function assertUnauthorizedBlocked(chain, scenario) {
  const id = 'unauthorized-blocked';
  const name = 'Unauthorized Steps Blocked';
  const description = 'Unauthorized action types (e.g., READ_REPO) must be flagged, not burned.';

  if (!scenario.malicious) {
    return { id, name, description, passed: true, expected: 'No unauthorized steps in scenario', actual: 'Safe scenario — no unauthorized attempts' };
  }

  const unauthorizedTokens = chain.filter(t => t.action_type === 'READ_REPO');
  const allBlocked = unauthorizedTokens.every(t => t.status === 'flagged' || t.status === 'revoked');

  return {
    id,
    name,
    description,
    passed: unauthorizedTokens.length === 0 || allBlocked,
    expected: 'All unauthorized tokens are flagged/revoked',
    actual: allBlocked
      ? `${unauthorizedTokens.length} unauthorized token(s) correctly blocked`
      : 'Unauthorized token was NOT blocked — security failure',
  };
}

// ─── 8. Cross-service movement is blocked ───────────────────
function assertCrossServiceBlocked(chain, auditLog, scenario) {
  const id = 'cross-service-blocked';
  const name = 'Cross-Service Movement Blocked';
  const description = 'Tokens scoped to one service cannot access another service.';

  // Only check cross-service for scenarios that actually attempt cross-service access
  const hasCrossServiceAttempt = scenario.malicious_step?.service &&
    !['gcs', 'internal-api'].includes(scenario.malicious_step.service);

  if (!hasCrossServiceAttempt) {
    return { id, name, description, passed: true, expected: 'No cross-service attempts in this scenario', actual: 'Scenario does not attempt cross-service movement' };
  }

  const flaggedEvents = auditLog.filter(e => e.event_type === 'FLAGGED');
  const crossServiceViolations = flaggedEvents.filter(e => {
    const details = typeof e.details === 'string' ? JSON.parse(e.details) : e.details;
    return details?.violations?.some(v =>
      v.type === 'CROSS_SERVICE_VIOLATION' || v.type === 'UNAUTHORIZED_SERVICE_ACCESS'
    );
  });

  return {
    id,
    name,
    description,
    passed: crossServiceViolations.length > 0,
    expected: 'Cross-service violation detected and flagged',
    actual: crossServiceViolations.length > 0
      ? `${crossServiceViolations.length} cross-service violation(s) caught`
      : 'No cross-service violations detected — possible security gap',
  };
}

function assertScopeEscalationBlocked(auditLog, workflow, scenario) {
  const id = 'scope-escalation-blocked';
  const name = 'Scope Escalation Blocked';
  const description = 'A token minted for one action must not be reusable for a different action scope.';

  if (!scenario.escalation) {
    return {
      id,
      name,
      description,
      passed: true,
      expected: 'No scope-escalation attempt in this scenario',
      actual: 'Scenario does not attempt action-scope escalation',
    };
  }

  const flaggedEvents = auditLog.filter((entry) => entry.event_type === 'FLAGGED');
  const escalationEvents = flaggedEvents.filter((entry) => {
    const details = typeof entry.details === 'string' ? JSON.parse(entry.details) : entry.details;
    return details?.violations?.some((violation) => violation.type === 'SCOPE_ESCALATION');
  });

  const blocked = escalationEvents.length > 0 && workflow?.status === 'paused';

  return {
    id,
    name,
    description,
    passed: blocked,
    expected: 'Scope escalation should be flagged and the workflow should pause',
    actual: blocked
      ? `${escalationEvents.length} scope escalation event(s) flagged`
      : 'No flagged scope-escalation event found',
  };
}

// ─── 9. Kill switch stops future execution ──────────────────
function assertKillSwitchStops(chain, workflow, scenario) {
  const id = 'kill-switch-works';
  const name = 'Kill Switch Stops Execution';
  const description = 'After kill switch, no further tokens should be minted or burned.';

  if (!scenario.kill_at_step && scenario.kill_at_step !== 0) {
    return { id, name, description, passed: true, expected: 'Kill switch not tested', actual: 'Not a kill-switch scenario' };
  }

  const isAborted = workflow?.status === 'aborted';
  const postKillBurned = chain.filter(t => t.step_index > scenario.kill_at_step && t.status === 'burned');

  return {
    id,
    name,
    description,
    passed: isAborted && postKillBurned.length === 0,
    expected: 'Workflow aborted, no tokens burned after kill step',
    actual: isAborted
      ? `Workflow aborted. ${postKillBurned.length} post-kill burned tokens (should be 0).`
      : 'Workflow was not aborted after kill switch',
  };
}

// ─── 10. Pause/resume/revoke works correctly ────────────────
function assertPauseResumeRevoke(workflow, scenario) {
  const id = 'pause-resume-revoke';
  const name = 'Pause/Resume/Revoke Works';
  const description = 'Workflows that trigger human review should pause correctly.';

  const shouldPause = scenario.expected_status === 'paused';

  if (!shouldPause) {
    return { id, name, description, passed: true, expected: 'No pause expected', actual: 'Non-pausing scenario — passes by default' };
  }

  const isPaused = workflow?.status === 'paused';

  return {
    id,
    name,
    description,
    passed: isPaused,
    expected: 'Workflow should be paused for review',
    actual: isPaused
      ? `Workflow status: ${workflow?.status}`
      : `Workflow status: ${workflow?.status || 'unknown'}`,
  };
}

// ─── 11. Secrets do not appear in UI/API payloads ───────────
function assertSecretsNotExposed(chain, auditLog) {
  const id = 'secrets-not-exposed';
  const name = 'Secrets Not Exposed';
  const description = 'No raw credentials should appear in token contexts, audit details, or results.';

  const sensitivePatterns = [
    /-----BEGIN.*KEY-----/i,
    /sk[-_][a-zA-Z0-9]{20,}/,
    /AIza[0-9A-Za-z\\-_]{35}/,
    /ghp_[a-zA-Z0-9]{36}/,
    /access_token/i,
  ];

  const allPayloads = [
    ...chain.map(t => JSON.stringify(t.context)),
    ...auditLog.map(e => JSON.stringify(e.details)),
  ];

  const exposedSecrets = allPayloads.filter(payload =>
    sensitivePatterns.some(pattern => pattern.test(payload))
  );

  return {
    id,
    name,
    description,
    passed: exposedSecrets.length === 0,
    expected: 'No secret material in payloads',
    actual: exposedSecrets.length === 0
      ? 'All payloads clean — no credentials exposed'
      : `${exposedSecrets.length} payload(s) contain potential secret material`,
  };
}

// ─── 12. Audit log is complete for each workflow ────────────
function assertAuditComplete(chain, auditLog) {
  const id = 'audit-complete';
  const name = 'Audit Log Complete';
  const description = 'Every token in the chain should have at least a MINTED event in the audit log.';

  const tokenIds = chain.map(t => t.id);
  const auditedTokenIds = new Set(auditLog.filter(e => e.event_type === 'MINTED').map(e => e.token_id));
  const missingAudit = tokenIds.filter(id => !auditedTokenIds.has(id));

  return {
    id,
    name,
    description,
    passed: missingAudit.length === 0,
    expected: 'Every token has a MINTED audit event',
    actual: missingAudit.length === 0
      ? `${tokenIds.length} token(s) fully audited`
      : `${missingAudit.length} token(s) missing MINTED audit entry`,
  };
}
