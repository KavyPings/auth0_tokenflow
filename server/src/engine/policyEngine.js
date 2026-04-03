// ═══════════════════════════════════════════════════════════
// Policy Engine — Governs token minting and security enforcement
// Enforces: cross-service isolation, scope boundaries, step ordering
// ═══════════════════════════════════════════════════════════

// Valid workflow step ordering (the legitimate DAG)
const STEP_ORDER = [
  'READ_OBJECT',
  'CALL_INTERNAL_API',
  'WRITE_OBJECT',
];

// Services that are explicitly unauthorized for the agent
const UNAUTHORIZED_SERVICES = ['source-control', 'internal-repo'];

// Mapping of each step to the service and action it's allowed to use
const STEP_PERMISSIONS = {
  READ_OBJECT: { service: 'gcs', action: 'read', resource: 'bucket/data-input' },
  CALL_INTERNAL_API: { service: 'internal-api', action: 'invoke', resource: 'api/process' },
  WRITE_OBJECT: { service: 'gcs', action: 'write', resource: 'bucket/data-output' },
  // READ_REPO is NOT here — it's unauthorized
};

// Actions that require step-up authentication
const STEP_UP_ACTIONS = ['WRITE_OBJECT'];

class PolicyEngine {
  /**
   * Check if a token can be minted for the given action
   * @returns {{ allowed: boolean, reason?: string, requiresStepUp?: boolean }}
   */
  canMint(actionType, context = {}) {
    // Check if action is in legitimate workflow
    if (!STEP_ORDER.includes(actionType)) {
      return { allowed: false, reason: `Unknown or unauthorized action type: ${actionType}` };
    }

    // Check step-up requirement
    if (this.requiresStepUp(actionType)) {
      return {
        allowed: true,
        requiresStepUp: true,
        reason: `Action ${actionType} requires step-up authentication`,
      };
    }

    return { allowed: true };
  }

  /**
   * Cross-service check: validate that the token's service matches the requested service
   * @returns {{ allowed: boolean, violation?: string, details?: object }}
   */
  checkServiceScope(tokenContext, requestedService) {
    const tokenService = tokenContext?.service;

    if (!tokenService) {
      return { allowed: false, violation: 'MISSING_SERVICE_SCOPE', details: { requestedService } };
    }

    // Check if the requested service is explicitly unauthorized
    if (UNAUTHORIZED_SERVICES.includes(requestedService)) {
      return {
        allowed: false,
        violation: 'UNAUTHORIZED_SERVICE_ACCESS',
        details: {
          tokenService,
          requestedService,
          message: `Access to service "${requestedService}" is explicitly prohibited`,
        },
      };
    }

    // Cross-service check
    if (tokenService !== requestedService) {
      return {
        allowed: false,
        violation: 'CROSS_SERVICE_VIOLATION',
        details: {
          tokenService,
          requestedService,
          message: `Token scoped to service "${tokenService}" cannot access service "${requestedService}"`,
        },
      };
    }

    return { allowed: true };
  }

  /**
   * Scope escalation check: validate that the token's action matches the requested action
   * @returns {{ allowed: boolean, violation?: string, details?: object }}
   */
  checkScopeEscalation(tokenContext, requestedAction) {
    const tokenAction = tokenContext?.action;

    if (!tokenAction) {
      return { allowed: false, violation: 'MISSING_ACTION_SCOPE', details: { requestedAction } };
    }

    if (tokenAction !== requestedAction) {
      return {
        allowed: false,
        violation: 'SCOPE_ESCALATION',
        details: {
          tokenAction,
          requestedAction,
          message: `Token authorized for action "${tokenAction}" cannot perform action "${requestedAction}"`,
        },
      };
    }

    return { allowed: true };
  }

  /**
   * Unauthorized step detection:
   * Check if an action at a given step index is within the defined chain
   * @returns {{ allowed: boolean, violation?: string, details?: object }}
   */
  checkUnauthorizedStep(actionType, stepIndex) {
    if (stepIndex >= STEP_ORDER.length) {
      return {
        allowed: false,
        violation: 'CHAIN_OVERFLOW',
        details: {
          actionType,
          stepIndex,
          maxSteps: STEP_ORDER.length,
          message: `Step index ${stepIndex} exceeds defined workflow chain (max: ${STEP_ORDER.length - 1})`,
        },
      };
    }

    const expectedAction = STEP_ORDER[stepIndex];
    if (expectedAction !== actionType) {
      return {
        allowed: false,
        violation: 'UNAUTHORIZED_STEP',
        details: {
          attempted: actionType,
          expected: expectedAction,
          stepIndex,
          message: `Step ${stepIndex} expects "${expectedAction}" but agent attempted "${actionType}"`,
        },
      };
    }

    return { allowed: true };
  }

  /**
   * Full security validation — runs all checks
   * @returns {{ allowed: boolean, violations: object[] }}
   */
  validateExecution(actionType, stepIndex, tokenContext, requestedService, requestedAction) {
    const violations = [];

    // Step ordering check
    const stepCheck = this.checkUnauthorizedStep(actionType, stepIndex);
    if (!stepCheck.allowed) violations.push(stepCheck);

    // Service scope check
    const serviceCheck = this.checkServiceScope(tokenContext, requestedService);
    if (!serviceCheck.allowed) violations.push(serviceCheck);

    // Action scope check
    const actionCheck = this.checkScopeEscalation(tokenContext, requestedAction);
    if (!actionCheck.allowed) violations.push(actionCheck);

    return {
      allowed: violations.length === 0,
      violations,
    };
  }

  /**
   * Check if action requires step-up authentication
   */
  requiresStepUp(actionType) {
    return STEP_UP_ACTIONS.includes(actionType);
  }

  /**
   * Get permission context for a given step action
   */
  getStepPermissions(actionType) {
    return STEP_PERMISSIONS[actionType] || null;
  }

  /**
   * Get expected next action for a workflow step
   */
  getNextAction(currentStepIndex) {
    if (currentStepIndex + 1 < STEP_ORDER.length) {
      return STEP_ORDER[currentStepIndex + 1];
    }
    return null;
  }

  /**
   * Get all valid action types in order
   */
  getStepOrder() {
    return [...STEP_ORDER];
  }

  /**
   * Get unauthorized services list (for frontend display)
   */
  getUnauthorizedServices() {
    return [...UNAUTHORIZED_SERVICES];
  }
}

export const policyEngine = new PolicyEngine();
