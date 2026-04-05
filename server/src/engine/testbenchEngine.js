// ═══════════════════════════════════════════════════════════
// Testbench Engine — Runs scenarios in isolated test contexts
//
// Each test run:
// 1. Starts a workflow from a scenario definition
// 2. Waits for completion (with timeout)
// 3. Collects the token chain and audit log
// 4. Runs assertion checks
// 5. Persists results to the test_runs table
// ═══════════════════════════════════════════════════════════

import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database.js';
import { workflowRunner } from './workflowRunner.js';
import { tokenEngine } from './tokenEngine.js';
import { runAssertions } from './testbenchAssertions.js';
import { ALL_TASKS } from '../data/agentTasks.js';
import { validateWorkflow } from './workflowSchema.js';

// Maximum time to wait for a workflow to settle (ms)
const RUN_TIMEOUT = 30000;
const POLL_INTERVAL = 200;

class TestbenchEngine {
  /**
   * Run a single scenario as an isolated test.
   * @param {string} scenarioId — ID from agentTasks
   * @returns {object} — test run result
   */
  async runScenario(scenarioId) {
    const scenario = this._resolveScenario(scenarioId);
    if (!scenario) throw new Error(`Scenario ${scenarioId} not found`);

    const runId = `run_${uuidv4().slice(0, 12)}`;
    const startTime = Date.now();

    // Persist initial run record
    const db = getDb();
    db.prepare(`
      INSERT INTO test_runs (id, scenario_id, scenario_name, status, started_at)
      VALUES (?, ?, ?, 'running', ?)
    `).run(runId, scenarioId, scenario.name, new Date().toISOString());

    try {
      if (scenario.source === 'uploaded' && scenario.runnable === false) {
        const durationMs = Date.now() - startTime;
        const summary = {
          scenarioId,
          scenarioName: scenario.name,
          category: scenario.category,
          validationErrors: scenario.validationErrors || [],
          error: scenario.lastError || 'Uploaded workflow is invalid and cannot be executed.',
          durationMs,
        };

        db.prepare(`
          UPDATE test_runs SET status = 'error', summary = ?, completed_at = ?, duration_ms = ? WHERE id = ?
        `).run(JSON.stringify(summary), new Date().toISOString(), durationMs, runId);

        return {
          runId,
          status: 'error',
          scenarioId,
          scenarioName: scenario.name,
          error: summary.error,
          validationErrors: summary.validationErrors,
          durationMs,
        };
      }

      // Start workflow in deterministic mode (fast, no random delays)
      const result = await workflowRunner.startWorkflow(scenario, {
        deterministic: true,
        stepDelay: 100,
        workflowType: 'testbench',
      });
      const workflowId = result.workflowId;

      // Wait for workflow to settle (completed, aborted, or paused)
      await this._waitForCompletion(workflowId);

      // Collect results
      const chain = tokenEngine.getTokenChain(workflowId);
      const auditLog = tokenEngine.getAuditLog(workflowId);
      const workflow = workflowRunner.getWorkflow(workflowId);

      // Run assertions
      const assertionResults = runAssertions({ scenario, chain, auditLog, workflow });

      const durationMs = Date.now() - startTime;
      const status = assertionResults.failed === 0 ? 'passed' : 'failed';

      const summary = {
        scenarioId,
        scenarioName: scenario.name,
        category: scenario.category,
        workflowId,
        workflowStatus: workflow?.status,
        ...assertionResults,
        durationMs,
      };

      // Persist final result
      db.prepare(`
        UPDATE test_runs
        SET status = ?, assertions = ?, summary = ?, token_chain = ?, audit_log = ?, completed_at = ?, duration_ms = ?
        WHERE id = ?
      `).run(
        status,
        JSON.stringify(assertionResults.assertions),
        JSON.stringify(summary),
        JSON.stringify(chain),
        JSON.stringify(auditLog),
        new Date().toISOString(),
        durationMs,
        runId
      );

      return { runId, status, ...summary };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      db.prepare(`
        UPDATE test_runs SET status = 'error', summary = ?, completed_at = ?, duration_ms = ? WHERE id = ?
      `).run(JSON.stringify({ error: error.message }), new Date().toISOString(), durationMs, runId);

      return {
        runId,
        status: 'error',
        scenarioId,
        scenarioName: scenario.name,
        error: error.message,
        durationMs,
      };
    }
  }

  /**
   * Run all scenarios as a test suite.
   * @returns {object} — suite result
   */
  async runSuite() {
    const suiteId = `suite_${uuidv4().slice(0, 8)}`;
    const startTime = Date.now();
    const results = [];
    const scenarios = this.getScenarios();

    for (const scenario of scenarios) {
      const result = await this.runScenario(scenario.id);
      results.push(result);
    }

    const passed = results.filter(r => r.status === 'passed').length;
    const failed = results.filter(r => r.status === 'failed').length;
    const errors = results.filter(r => r.status === 'error').length;
    const durationMs = Date.now() - startTime;

    return {
      suiteId,
      status: failed === 0 && errors === 0 ? 'passed' : 'failed',
      results,
      summary: { passed, failed, errors, total: scenarios.length, durationMs },
    };
  }

  /**
   * Get all available test scenarios.
   */
  getScenarios() {
    const baseScenarios = ALL_TASKS.map(t => ({
      id: t.id,
      name: t.name,
      description: t.description,
      category: t.category,
      malicious: t.malicious,
      incident_mapping: t.incident_mapping,
      steps: t.steps,
    }));

    const uploadedScenarios = this._getUploadedScenarios();
    return [...baseScenarios, ...uploadedScenarios];
  }

  /**
   * Get persisted test results.
   */
  getResults(limit = 50) {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM test_runs ORDER BY started_at DESC LIMIT ?').all(limit);
    return rows.map(r => {
      try { r.assertions = JSON.parse(r.assertions); } catch { r.assertions = []; }
      try { r.summary = JSON.parse(r.summary); } catch { r.summary = {}; }
      try { r.token_chain = JSON.parse(r.token_chain); } catch { r.token_chain = []; }
      try { r.audit_log = JSON.parse(r.audit_log); } catch { r.audit_log = []; }
      return r;
    });
  }

  /**
   * Get a specific test run result.
   */
  getResult(runId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM test_runs WHERE id = ?').get(runId);
    if (!row) return null;
    try { row.assertions = JSON.parse(row.assertions); } catch { row.assertions = []; }
    try { row.summary = JSON.parse(row.summary); } catch { row.summary = {}; }
    try { row.token_chain = JSON.parse(row.token_chain); } catch { row.token_chain = []; }
    try { row.audit_log = JSON.parse(row.audit_log); } catch { row.audit_log = []; }
    return row;
  }

  // ─── Internal: poll for workflow completion ───────────────
  async _waitForCompletion(workflowId) {
    const deadline = Date.now() + RUN_TIMEOUT;

    while (Date.now() < deadline) {
      const wf = workflowRunner.getWorkflow(workflowId);
      if (!wf) throw new Error(`Workflow ${workflowId} disappeared`);

      if (['completed', 'aborted', 'paused'].includes(wf.status)) {
        return wf;
      }

      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));
    }

    throw new Error(`Workflow ${workflowId} did not complete within ${RUN_TIMEOUT}ms`);
  }

  _resolveScenario(scenarioId) {
    const builtInScenario = ALL_TASKS.find(t => t.id === scenarioId);
    if (builtInScenario) {
      return builtInScenario;
    }

    return this._getUploadedScenarios().find((scenario) => scenario.id === scenarioId) || null;
  }

  _getUploadedScenarios() {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM uploaded_workflows ORDER BY uploaded_at DESC').all();

    return rows.map((row) => {
      let definition = {};
      try {
        definition = JSON.parse(row.definition);
      } catch {
        definition = {};
      }

      let validationErrors = [];
      try {
        validationErrors = JSON.parse(row.validation_errors || '[]');
      } catch {
        validationErrors = [];
      }

      if (Object.keys(definition).length > 0) {
        const validation = validateWorkflow(definition);
        validationErrors = validation.valid ? [] : validation.errors;
      } else if (validationErrors.length === 0) {
        validationErrors = ['Stored workflow definition is unreadable.'];
      }

      const runnable = validationErrors.length === 0;

      return {
        id: row.id,
        name: definition.name || row.name,
        description: definition.description || row.description || 'Uploaded custom workflow',
        category: 'uploaded',
        malicious: false,
        incident_mapping: runnable
          ? 'Custom uploaded workflow validated against the same TokenFlow security invariants.'
          : 'Uploaded workflow is stored for inspection, but currently fails validation against TokenFlow policy.',
        steps: Array.isArray(definition.steps) ? definition.steps : [],
        source: 'uploaded',
        uploadStatus: row.status,
        validationErrors,
        lastError: row.last_error || '',
        runnable,
      };
    });
  }
}

export const testbenchEngine = new TestbenchEngine();
