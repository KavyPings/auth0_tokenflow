// ═══════════════════════════════════════════════════════════
// Workflow Runner — Orchestrates the AI agent execution demo
// Demonstrates: normal execution, malicious step detection,
// cross-service blocking, and token chain enforcement
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
   * Start a new agent workflow
   */
  async startWorkflow(taskData) {
    const db = getDb();
    const workflowId = `wf_${uuidv4().slice(0, 12)}`;

    db.prepare(`
      INSERT INTO workflows (id, name, status, applicant_data, current_step)
      VALUES (?, ?, 'running', ?, 0)
    `).run(workflowId, `Agent Task — ${taskData.name}`, JSON.stringify(taskData));

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
    setTimeout(() => this.executeStep(workflowId, 0), STEP_DELAY);

    return { workflowId, status: 'running', taskData };
  }

  /**
   * Execute a specific workflow step
   */
  async executeStep(workflowId, stepIndex) {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
    if (workflow.status === 'aborted' || workflow.status === 'completed') return;

    const taskData = JSON.parse(workflow.applicant_data);
    const steps = policyEngine.getStepOrder();

    // ── MALICIOUS STEP INJECTION ──────────────────────────────
    // If the task is malicious and we've just finished step 2 (CALL_INTERNAL_API),
    // inject the unauthorized READ_REPO attempt before WRITE_OBJECT
    if (taskData.malicious && stepIndex === 2 && taskData.malicious_step) {
      console.log(`[WORKFLOW] ⚠ Compromised agent attempting unauthorized step...`);
      await this._attemptMaliciousStep(workflowId, taskData, stepIndex);
      return; // Execution halts — the malicious step was blocked
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
    const tokenContext = {
      taskData: { id: taskData.id, name: taskData.name },
      stepIndex,
      service: stepPermissions?.service || stepDef?.service,
      resource: stepPermissions?.resource || stepDef?.resource,
      action: stepPermissions?.action || stepDef?.actionVerb,
    };

    const token = tokenEngine.mintToken(
      workflowId,
      actionType,
      stepDef?.resource || stepPermissions?.resource,
      AGENT_ID,
      tokenContext,
      parentTokenId,
      stepIndex
    );

    // Short delay, then activate and execute
    await this._delay(STEP_DELAY);

    // Check workflow is still alive
    const currentWorkflow = this.getWorkflow(workflowId);
    if (currentWorkflow.status === 'aborted') return;

    tokenEngine.activateToken(token.id);
    this._updateWorkflow(workflowId, 'running', stepIndex);

    await this._delay(STEP_DELAY);

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
      await this._delay(STEP_DELAY);
      this.executeStep(workflowId, stepIndex + 1);
    } catch (error) {
      console.error(`[WORKFLOW] Step ${stepIndex} failed:`, error.message);
      tokenEngine.revokeToken(token.id, `Execution failed: ${error.message}`, 'system');
      this._updateWorkflow(workflowId, 'aborted', stepIndex);
    }
  }

  /**
   * Attempt an unauthorized (malicious) step — this SHOULD be blocked
   */
  async _attemptMaliciousStep(workflowId, taskData, stepIndex) {
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

    await this._delay(STEP_DELAY);

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
   * Resume a paused workflow after human review approval
   */
  async resumeWorkflow(workflowId) {
    const db = getDb();
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`);
    if (workflow.status !== 'paused') throw new Error(`Workflow ${workflowId} is ${workflow.status}, not paused`);

    const taskData = JSON.parse(workflow.applicant_data);

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

    // If the task was malicious and we were at step 2 (the malicious injection point),
    // resume at step 2 which is WRITE_OBJECT in the legitimate chain
    const resumeStep = workflow.current_step;
    // The flagged step was an injected malicious step at index 2,
    // so resuming means continuing with legitimate step 2 (WRITE_OBJECT)
    this.executeStep(workflowId, resumeStep);

    return { workflowId, status: 'running' };
  }

  /**
   * Abort a workflow after human review rejection
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
   * Kill switch — immediately revoke everything
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

  listWorkflows() {
    const db = getDb();
    return db.prepare('SELECT * FROM workflows ORDER BY created_at DESC').all();
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

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export const workflowRunner = new WorkflowRunner();
