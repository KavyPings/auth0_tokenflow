// ═══════════════════════════════════════════════════════════
// Workflow Runner — Orchestrates the AI agent execution
// Supports: normal execution, malicious step detection,
// cross-service blocking, token chain enforcement,
// replay attacks, kill-switch, human review, and
// deterministic testbench mode.
// ═══════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database.js';
import { tokenEngine } from './tokenEngine.js';
import { policyEngine } from './policyEngine.js';
import { readCloudObject, callInternalApi, writeCloudObject, readRepo } from '../services/agentService.js';
import { vaultService } from '../services/vaultService.js';
import { broadcast } from '../websocket/wsServer.js';

const AGENT_ID = 'agent-cloud-worker';

// Step execution delay (ms) — slowed for visual demo
const STEP_DELAY = 1500;

class WorkflowRunner {
  /**
   * Start a new agent workflow.
   * @param {object} taskData — scenario definition
   * @param {object} [opts] — { deterministic: bool, stepDelay: number }
   */
  async startWorkflow(taskData, opts = {}) {
    const db = getDb();
    const workflowId = `wf_${uuidv4().slice(0, 12)}`;
    const deterministic = opts.deterministic || false;
    const stepDelay = deterministic ? 50 : (opts.stepDelay || STEP_DELAY);
    const workflowType = opts.workflowType || 'mission';

    db.prepare(`
      INSERT INTO workflows (id, name, status, applicant_data, workflow_type, current_step)
      VALUES (?, ?, 'running', ?, ?, 0)
    `).run(workflowId, `Agent Task — ${taskData.name}`, JSON.stringify(taskData), workflowType);

    broadcast({
      type: 'WORKFLOW_EVENT',
      payload: {
        event: 'STARTED',
        workflowId,
        taskData,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[WORKFLOW] Started ${workflowId} for task ${taskData.name}`);

    // Begin step 1 after a short delay for visual effect
    setTimeout(() => this.executeStep(workflowId, 0, { deterministic, stepDelay }), stepDelay);

    return { workflowId, status: 'running', taskData };
  }

  /**
   * Execute a specific workflow step.
   */
  async executeStep(workflowId, stepIndex, opts = {}) {
    const deterministic = opts.deterministic || false;
    const stepDelay = opts.stepDelay || STEP_DELAY;

    const workflow = this.getWorkflow(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
    if (workflow.status === 'aborted' || workflow.status === 'completed') return;

    const taskData = JSON.parse(workflow.applicant_data);
    const steps = policyEngine.getStepOrder();
    const approvedSteps = new Set(taskData.approved_steps || []);

    // ── MALICIOUS STEP INJECTION ──────────────────────────────
    // If the task is malicious and we've just finished step 2 (CALL_INTERNAL_API),
    // inject the unauthorized READ_REPO attempt before WRITE_OBJECT
    if (taskData.malicious && stepIndex === 2 && taskData.malicious_step && !approvedSteps.has(stepIndex)) {
      console.log(`[WORKFLOW] ⚠ Compromised agent attempting unauthorized step...`);
      await this._attemptMaliciousStep(workflowId, taskData, stepIndex, opts);
      return; // Execution halts — the malicious step was blocked
    }

    // ── REPLAY ATTACK ─────────────────────────────────────────
    // If the task has replay=true and we're at step 1 (after READ_OBJECT burned),
    // attempt to reuse the burned token
    if (taskData.replay && stepIndex === 1) {
      console.log(`[WORKFLOW] ⚠ Replay attack — agent attempting to reuse burned token...`);
      await this._attemptReplay(workflowId, taskData, stepIndex, opts);
      // After replay attempt is blocked, continue normally
    }

    // ── KILL SWITCH ───────────────────────────────────────────
    if (taskData.kill_at_step !== undefined && stepIndex === taskData.kill_at_step) {
      console.log(`[WORKFLOW] ⚠ Kill switch triggered at step ${stepIndex}`);
      await this.killWorkflow(workflowId);
      return;
    }

    const actionType = steps[stepIndex];

    if (!actionType) {
      this._updateWorkflow(workflowId, 'completed', stepIndex);
      broadcast({ type: 'WORKFLOW_EVENT', payload: { event: 'COMPLETED', workflowId, timestamp: new Date().toISOString() } });
      console.log(`[WORKFLOW] Completed ${workflowId}`);
      return;
    }

    // Get step permissions from policy engine
    const stepPermissions = policyEngine.getStepPermissions(actionType);
    const stepDef = taskData.steps?.[stepIndex];

    // Get previous token ID for chain linking
    const chain = tokenEngine.getTokenChain(workflowId);
    const parentTokenId = chain.length > 0 ? chain[chain.length - 1].id : null;

    // Mint token for this step
    const policy = policyEngine.canMint(actionType, { taskData });
    if (!policy.allowed) {
      console.error(`[WORKFLOW] Policy denied minting for ${actionType}: ${policy.reason}`);
      return;
    }

    // Token context includes service, resource, action scoping
    // Use stepDef (scenario-specific) values first, then fallback to stepPermissions
    const resourcePath = stepDef?.resource || stepPermissions?.resource;
    const tokenContext = {
      taskData: { id: taskData.id, name: taskData.name },
      stepIndex,
      service: stepDef?.service || stepPermissions?.service,
      resource: resourcePath,
      action: stepDef?.actionVerb || stepPermissions?.action,
    };

    const token = tokenEngine.mintToken(
      workflowId,
      actionType,
      resourcePath,
      AGENT_ID,
      tokenContext,
      parentTokenId,
      stepIndex
    );

    // Short delay, then activate and execute
    await this._delay(stepDelay);

    // Check workflow is still alive
    const currentWorkflow = this.getWorkflow(workflowId);
    if (currentWorkflow.status === 'aborted') return;

    // ── HUMAN REVIEW PAUSE ────────────────────────────────────
    if (taskData.pause_at_step !== undefined && stepIndex === taskData.pause_at_step && !approvedSteps.has(stepIndex)) {
      tokenEngine.activateToken(token.id);
      tokenEngine.flagToken(token.id, 'STEP_UP_REQUIRED', {
        summary: `Step ${stepIndex} (${actionType}) requires human review before execution.`,
        attempted_action: actionType,
        attempted_service: stepDef?.service || stepPermissions?.service,
        attempted_resource: stepDef?.resource || stepPermissions?.resource,
        taskData: { id: taskData.id, name: taskData.name },
      });
      this._updateWorkflow(workflowId, 'paused', stepIndex);
      console.log(`[WORKFLOW] Paused ${workflowId} at step ${stepIndex} for human review`);
      return;
    }

    tokenEngine.activateToken(token.id);
    this._updateWorkflow(workflowId, 'running', stepIndex);

    if (taskData.escalation && !approvedSteps.has(stepIndex)) {
      const escalationBlocked = await this._attemptScopeEscalation(
        workflowId,
        taskData,
        stepIndex,
        token,
        tokenContext,
        steps,
        opts
      );
      if (escalationBlocked) {
        return;
      }
    }

    await this._delay(stepDelay);

    // Execute the step action
    try {
      const result = await this._executeAction(actionType, taskData, workflowId, token.id, stepIndex);

      // Check if security violation was flagged — pause workflow
      if (result._paused) {
        this._updateWorkflow(workflowId, 'paused', stepIndex);
        return; // Wait for human review
      }

      // Consume (burn) the token
      tokenEngine.consumeToken(token.id, result);

      // Auto-advance to next step after delay
      await this._delay(stepDelay);
      this.executeStep(workflowId, stepIndex + 1, opts);
    } catch (error) {
      console.error(`[WORKFLOW] Step ${stepIndex} failed:`, error.message);
      tokenEngine.revokeToken(token.id, `Execution failed: ${error.message}`, 'system');
      this._updateWorkflow(workflowId, 'aborted', stepIndex);
    }
  }

  /**
   * Attempt an unauthorized (malicious) step — this SHOULD be blocked.
   */
  async _attemptMaliciousStep(workflowId, taskData, stepIndex, opts = {}) {
    const stepDelay = opts.stepDelay || STEP_DELAY;
    const maliciousStep = taskData.malicious_step;
    const chain = tokenEngine.getTokenChain(workflowId);
    const parentTokenId = chain.length > 0 ? chain[chain.length - 1].id : null;

    // The compromised agent tries to mint a token for the unauthorized step
    // We mint it to show the attempt, then immediately flag it
    const tokenContext = {
      taskData: { id: taskData.id, name: taskData.name },
      stepIndex,
      service: maliciousStep.service,        // source-control (unauthorized!)
      resource: maliciousStep.resource,       // internal/secrets-config.yaml
      action: maliciousStep.actionVerb,       // read
      malicious: true,
    };

    // Mint token for the unauthorized step (to show the attempt in the chain)
    const token = tokenEngine.mintToken(
      workflowId,
      maliciousStep.action,                   // READ_REPO
      maliciousStep.resource,
      AGENT_ID,
      tokenContext,
      parentTokenId,
      stepIndex
    );

    await this._delay(stepDelay);

    // Run security validation
    const validation = policyEngine.validateExecution(
      maliciousStep.action,
      stepIndex,
      tokenContext,
      maliciousStep.service,
      maliciousStep.actionVerb
    );

    if (!validation.allowed) {
      console.log(`[WORKFLOW] 🛑 SECURITY VIOLATION DETECTED — Blocking unauthorized step`);

      // Flag the token with all violation details
      tokenEngine.flagToken(token.id, 'SECURITY_VIOLATION', {
        violations: validation.violations.map(v => ({
          type: v.violation,
          ...v.details,
        })),
        summary: `Unauthorized cross-service access detected: Agent attempted to access "${maliciousStep.service}" service to read "${maliciousStep.resource}"`,
        attempted_action: maliciousStep.action,
        attempted_service: maliciousStep.service,
        attempted_resource: maliciousStep.resource,
        taskData: { id: taskData.id, name: taskData.name },
      });

      this._updateWorkflow(workflowId, 'paused', stepIndex);
      return;
    }
  }

  /**
   * Attempt a replay attack — reuse a burned token.
   */
  async _attemptReplay(workflowId, taskData, stepIndex, opts = {}) {
    const stepDelay = opts.stepDelay || STEP_DELAY;
    const chain = tokenEngine.getTokenChain(workflowId);
    const burnedToken = chain.find(t => t.status === 'burned');

    if (burnedToken) {
      try {
        // Agent tries to consume the already-burned token
        tokenEngine.consumeToken(burnedToken.id, { replay_attempt: true });
      } catch (err) {
        console.log(`[WORKFLOW] 🛑 REPLAY BLOCKED: ${err.message}`);
        // Replay was blocked — continue with normal flow
      }
      await this._delay(stepDelay);
    }
  }

  /**
   * Attempt a scope escalation using the currently active token.
   */
  async _attemptScopeEscalation(workflowId, taskData, stepIndex, token, tokenContext, stepOrder, opts = {}) {
    const stepDelay = opts.stepDelay || STEP_DELAY;
    const escalationStep = taskData.escalation_step || {
      action: 'WRITE_OBJECT',
      service: tokenContext.service,
      resource: tokenContext.resource,
      actionVerb: 'write',
    };

    await this._delay(stepDelay);

    const validation = policyEngine.validateExecution(
      escalationStep.action,
      stepIndex,
      tokenContext,
      escalationStep.service,
      escalationStep.actionVerb,
      stepOrder
    );

    if (!validation.allowed) {
      console.log(`[WORKFLOW] Scope escalation detected — blocking token misuse`);

      tokenEngine.flagToken(token.id, 'SCOPE_ESCALATION', {
        violations: validation.violations.map((violation) => ({
          type: violation.violation,
          ...violation.details,
        })),
        summary: `Scope escalation blocked: token for "${tokenContext.action}" was misused to attempt "${escalationStep.actionVerb}" on "${escalationStep.resource}"`,
        attempted_action: escalationStep.action,
        attempted_service: escalationStep.service,
        attempted_resource: escalationStep.resource,
        taskData: { id: taskData.id, name: taskData.name },
      });

      this._updateWorkflow(workflowId, 'paused', stepIndex);
      return true;
    }

    return false;
  }

  /**
   * Resume a paused workflow after human review approval.
   */
  async resumeWorkflow(workflowId) {
    const db = getDb();
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
    if (workflow.status !== 'paused') throw new Error(`Workflow ${workflowId} is ${workflow.status}, not paused`);

    const taskData = JSON.parse(workflow.applicant_data);
    const approvedSteps = new Set(taskData.approved_steps || []);
    approvedSteps.add(workflow.current_step);
    taskData.approved_steps = [...approvedSteps];
    this._updateWorkflowTaskData(workflowId, taskData);

    // Find the flagged token and burn it with review result
    const chain = tokenEngine.getTokenChain(workflowId);
    const flaggedToken = chain.find(t => t.status === 'flagged');

    if (flaggedToken) {
      // Reactivate and consume the flagged token
      const tDb = getDb();
      tDb.prepare(`UPDATE tokens SET status = 'active' WHERE id = ?`).run(flaggedToken.id);
      tokenEngine.consumeToken(flaggedToken.id, { review: 'approved', reviewer: 'human' });
    }

    this._updateWorkflow(workflowId, 'running', workflow.current_step);

    broadcast({
      type: 'WORKFLOW_EVENT',
      payload: {
        event: 'RESUMED',
        workflowId,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[WORKFLOW] Resumed ${workflowId}`);

    // Continue to the next legitimate step (skip the malicious one)
    await this._delay(STEP_DELAY);

    const resumeStep = workflow.current_step;
    this.executeStep(workflowId, resumeStep);

    return { workflowId, status: 'running' };
  }

  /**
   * Abort a workflow after human review rejection.
   */
  async abortWorkflow(workflowId) {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);

    // Revoke all active tokens
    tokenEngine.revokeAllActive(workflowId);
    this._updateWorkflow(workflowId, 'aborted', workflow.current_step);

    broadcast({
      type: 'WORKFLOW_EVENT',
      payload: {
        event: 'ABORTED',
        workflowId,
        reason: 'Human reviewer rejected — security violation confirmed',
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[WORKFLOW] Aborted ${workflowId}`);
    return { workflowId, status: 'aborted' };
  }

  /**
   * Kill switch — immediately revoke everything.
   */
  async killWorkflow(workflowId) {
    const revokedCount = tokenEngine.revokeAllActive(workflowId);
    this._updateWorkflow(workflowId, 'aborted', null);

    broadcast({
      type: 'WORKFLOW_EVENT',
      payload: {
        event: 'KILLED',
        workflowId,
        revokedCount,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[WORKFLOW] Killed ${workflowId} — revoked ${revokedCount} tokens`);
    return { workflowId, status: 'aborted', revokedCount };
  }

  // ─── Internal action execution ────────────────────────────

  async _executeAction(actionType, taskData, workflowId, tokenId, stepIndex) {
    const stepDef = taskData.steps?.[stepIndex];

    switch (actionType) {
      case 'READ_OBJECT':
        return readCloudObject(stepDef?.resource || 'default/input.json');

      case 'CALL_INTERNAL_API':
        return callInternalApi(stepDef?.resource || 'api/process');

      case 'WRITE_OBJECT':
        return writeCloudObject(stepDef?.resource || 'default/output.json');

      default:
        throw new Error(`Unknown action: ${actionType}`);
    }
  }

  // ─── Query helpers ────────────────────────────────────────

  getWorkflow(workflowId) {
    const db = getDb();
    return db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId);
  }

  listWorkflows(options = {}) {
    const db = getDb();
    const { includeTestbench = false, workflowType = null } = options;

    if (workflowType) {
      return db.prepare(`
        SELECT * FROM workflows
        WHERE COALESCE(workflow_type, 'mission') = ?
        ORDER BY created_at DESC
      `).all(workflowType);
    }

    if (includeTestbench) {
      return db.prepare('SELECT * FROM workflows ORDER BY created_at DESC').all();
    }

    return db.prepare(`
      SELECT * FROM workflows
      WHERE COALESCE(workflow_type, 'mission') != 'testbench'
      ORDER BY created_at DESC
    `).all();
  }

  clearWorkflows(options = {}) {
    const db = getDb();
    const { workflowTypes = ['mission'], statuses = ['completed', 'aborted'] } = options;
    const workflowPlaceholders = workflowTypes.map(() => '?').join(', ');
    const statusPlaceholders = statuses.map(() => '?').join(', ');
    const workflows = db.prepare(`
      SELECT id FROM workflows
      WHERE COALESCE(workflow_type, 'mission') IN (${workflowPlaceholders})
        AND status IN (${statusPlaceholders})
        AND COALESCE(hidden_from_chain, 0) = 0
    `).all(...workflowTypes, ...statuses);

    if (workflows.length === 0) {
      return { count: 0, workflowIds: [] };
    }

    const workflowIds = workflows.map((workflow) => workflow.id);
    const hideWorkflow = db.prepare(`
      UPDATE workflows
      SET hidden_from_chain = 1, updated_at = ?
      WHERE id = ?
    `);
    const now = new Date().toISOString();

    db.transaction((ids) => {
      for (const workflowId of ids) {
        hideWorkflow.run(now, workflowId);
      }
    })(workflowIds);

    broadcast({
      type: 'WORKFLOW_EVENT',
      payload: {
        event: 'CLEARED',
        workflowIds,
        timestamp: new Date().toISOString(),
      },
    });

    return { count: workflowIds.length, workflowIds };
  }

  _updateWorkflow(workflowId, status, currentStep) {
    const db = getDb();
    const updates = { status, updated_at: new Date().toISOString() };
    if (currentStep !== null && currentStep !== undefined) {
      db.prepare('UPDATE workflows SET status = ?, current_step = ?, updated_at = ? WHERE id = ?')
        .run(status, currentStep, updates.updated_at, workflowId);
    } else {
      db.prepare('UPDATE workflows SET status = ?, updated_at = ? WHERE id = ?')
        .run(status, updates.updated_at, workflowId);
    }
  }

  _updateWorkflowTaskData(workflowId, taskData) {
    const db = getDb();
    db.prepare('UPDATE workflows SET applicant_data = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(taskData), new Date().toISOString(), workflowId);
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const workflowRunner = new WorkflowRunner();
