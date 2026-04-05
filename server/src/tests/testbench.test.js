// ═══════════════════════════════════════════════════════════
// Testbench Integration Tests
// Run with: node --test server/src/tests/testbench.test.js
// ═══════════════════════════════════════════════════════════

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';

// Setup: import the engine modules directly
// We must boot the DB first
import '../loadEnv.js';
import { getDb, closeDb } from '../db/database.js';
import { testbenchEngine } from '../engine/testbenchEngine.js';
import { validateWorkflow, sanitizeWorkflow } from '../engine/workflowSchema.js';
import { workflowRunner } from '../engine/workflowRunner.js';
import { tokenEngine } from '../engine/tokenEngine.js';
import { ALL_TASKS } from '../data/agentTasks.js';

before(() => {
  // Use in-memory DB for tests by setting env
  process.env.DATABASE_URL = ':memory:';
  getDb();
});

after(() => {
  closeDb();
});

describe('Testbench Engine', () => {
  it('should list all 7 scenarios', () => {
    const scenarios = testbenchEngine.getScenarios();
    assert.equal(scenarios.length, 7, 'Expected 7 scenarios');
    assert.ok(scenarios.some(s => s.id === 'SCENARIO-001'), 'Missing SCENARIO-001');
    assert.ok(scenarios.some(s => s.id === 'SCENARIO-002'), 'Missing SCENARIO-002');
  });

  it('should run SCENARIO-001 (Normal) and pass', async () => {
    const result = await testbenchEngine.runScenario('SCENARIO-001');
    assert.equal(result.status, 'passed', `Normal scenario should pass but got: ${result.status}`);
    assert.ok(result.passed > 0, 'Should have passing assertions');
    assert.equal(result.failed, 0, 'Should have zero failures');
  });

  it('should run SCENARIO-002 (Double Agent) and pass', async () => {
    const result = await testbenchEngine.runScenario('SCENARIO-002');
    assert.equal(result.status, 'passed', `Double Agent scenario should pass: ${JSON.stringify(result.assertions?.filter(a => !a.passed))}`);
  });

  it('should keep testbench workflows out of mission control lists', async () => {
    const result = await testbenchEngine.runScenario('SCENARIO-003');
    const missionWorkflows = workflowRunner.listWorkflows();
    const allWorkflows = workflowRunner.listWorkflows({ includeTestbench: true });

    assert.ok(allWorkflows.some((workflow) => workflow.id === result.workflowId), 'Expected testbench workflow to persist');
    assert.ok(!missionWorkflows.some((workflow) => workflow.id === result.workflowId), 'Testbench workflow should be hidden from mission control lists');
  });

  it('should run SCENARIO-004 (Replay) and pass', async () => {
    const result = await testbenchEngine.runScenario('SCENARIO-004');
    assert.equal(result.status, 'passed', `Replay scenario should pass: ${JSON.stringify(result.assertions?.filter(a => !a.passed))}`);
  });

  it('should run SCENARIO-005 (Scope Escalation) and pause the workflow', async () => {
    const result = await testbenchEngine.runScenario('SCENARIO-005');
    assert.equal(result.status, 'passed', `Scope escalation scenario should pass: ${JSON.stringify(result.assertions?.filter(a => !a.passed))}`);
    assert.equal(result.workflowStatus, 'paused', 'Scope escalation should pause for review');
  });

  it('should run SCENARIO-006 (Kill Switch) and pass', async () => {
    const result = await testbenchEngine.runScenario('SCENARIO-006');
    assert.equal(result.status, 'passed', `Kill Switch scenario should pass: ${JSON.stringify(result.assertions?.filter(a => !a.passed))}`);
  });

  it('should run SCENARIO-007 (Human Review) and pause the workflow', async () => {
    const result = await testbenchEngine.runScenario('SCENARIO-007');
    assert.equal(result.status, 'passed', `Human review scenario should pass: ${JSON.stringify(result.assertions?.filter(a => !a.passed))}`);
    assert.equal(result.workflowStatus, 'paused', 'Human review should pause for approval');
  });

  it('should keep every built-in mock workflow aligned with its documented outcome', async () => {
    for (const scenario of ALL_TASKS) {
      const result = await testbenchEngine.runScenario(scenario.id);
      assert.equal(
        result.workflowStatus,
        scenario.expected_status,
        `${scenario.id} (${scenario.name}) ended as ${result.workflowStatus} instead of ${scenario.expected_status}`
      );
    }
  });

  it('should persist test results', () => {
    const results = testbenchEngine.getResults(10);
    assert.ok(results.length > 0, 'Should have persisted results');
  });

  it('should expose uploaded workflows as testbench scenarios and run them', async () => {
    const db = getDb();
    const uploadedId = 'uwf_uploaded_test';
    db.prepare(`
      INSERT INTO uploaded_workflows (id, name, description, definition, status)
      VALUES (?, ?, ?, ?, 'validated')
    `).run(
      uploadedId,
      'Uploaded Test Workflow',
      'Custom uploaded workflow',
      JSON.stringify({
        name: 'Uploaded Test Workflow',
        description: 'Custom uploaded workflow',
        steps: [
          { action: 'READ_OBJECT', service: 'gcs', resource: 'uploads/input.json', actionVerb: 'read' },
          { action: 'CALL_INTERNAL_API', service: 'internal-api', resource: 'api/process', actionVerb: 'invoke' },
          { action: 'WRITE_OBJECT', service: 'gcs', resource: 'uploads/output.json', actionVerb: 'write' },
        ],
      }),
    );

    const scenarios = testbenchEngine.getScenarios();
    assert.ok(scenarios.some((scenario) => scenario.id === uploadedId), 'Uploaded workflow should appear in testbench scenarios');

    const result = await testbenchEngine.runScenario(uploadedId);
    assert.equal(result.status, 'passed', 'Uploaded workflow scenario should pass invariant checks');
  });

  it('should include uploaded workflows when running the full suite', async () => {
    const db = getDb();
    const uploadedId = 'uwf_suite_uploaded_test';
    db.prepare(`
      INSERT INTO uploaded_workflows (id, name, description, definition, status)
      VALUES (?, ?, ?, ?, 'validated')
    `).run(
      uploadedId,
      'Suite Uploaded Workflow',
      'Uploaded workflow included in suite',
      JSON.stringify({
        name: 'Suite Uploaded Workflow',
        description: 'Uploaded workflow included in suite',
        steps: [
          { action: 'READ_OBJECT', service: 'gcs', resource: 'suite/input.json', actionVerb: 'read' },
          { action: 'CALL_INTERNAL_API', service: 'internal-api', resource: 'api/suite', actionVerb: 'invoke' },
          { action: 'WRITE_OBJECT', service: 'gcs', resource: 'suite/output.json', actionVerb: 'write' },
        ],
      }),
    );

    const scenarios = testbenchEngine.getScenarios();
    const suiteResult = await testbenchEngine.runSuite();

    assert.equal(suiteResult.summary.total, scenarios.length, 'Suite total should match all available scenarios');
    assert.equal(suiteResult.results.length, scenarios.length, 'Suite should execute every available scenario');
    assert.ok(
      suiteResult.results.some((result) => result.scenarioId === uploadedId),
      'Suite results should include uploaded workflow scenarios'
    );
  });

  it('should expose invalid uploaded workflows and fail them safely in the testbench', async () => {
    const db = getDb();
    const uploadedId = 'uwf_invalid_uploaded_test';
    db.prepare(`
      INSERT INTO uploaded_workflows (id, name, description, definition, status, validation_errors, last_error)
      VALUES (?, ?, ?, ?, 'invalid', ?, ?)
    `).run(
      uploadedId,
      'Invalid Uploaded Workflow',
      'Uploaded workflow with a prohibited service',
      JSON.stringify({
        name: 'Invalid Uploaded Workflow',
        description: 'Uploaded workflow with a prohibited service',
        steps: [
          { action: 'CALL_INTERNAL_API', service: 'github', resource: 'api/process', actionVerb: 'invoke' },
        ],
      }),
      JSON.stringify(['Step 0: service must be one of: gcs, internal-api']),
      'Workflow definition failed validation',
    );

    const scenario = testbenchEngine.getScenarios().find((item) => item.id === uploadedId);
    assert.ok(scenario, 'Invalid uploaded workflow should still appear in the scenario list');
    assert.equal(scenario.runnable, false, 'Invalid uploaded workflow should be marked non-runnable');

    const result = await testbenchEngine.runScenario(uploadedId);
    assert.equal(result.status, 'error', 'Invalid uploaded workflow should fail safely');
    assert.ok(result.validationErrors?.length > 0, 'Validation errors should be returned');
  });

  it('should archive only settled mission workflows from token chain without removing audit or tokens', async () => {
    const db = getDb();
    const missionWorkflowId = 'wf_manual_mission';
    const runningWorkflowId = 'wf_manual_running';
    db.prepare(`
      INSERT INTO workflows (id, name, status, applicant_data, workflow_type, hidden_from_chain, current_step)
      VALUES (?, ?, 'completed', ?, 'mission', 0, 2)
    `).run(
      missionWorkflowId,
      'Agent Task — Mission Workflow',
      JSON.stringify({ id: 'MANUAL-001', name: 'Mission Workflow', steps: [] }),
    );

    db.prepare(`
      INSERT INTO workflows (id, name, status, applicant_data, workflow_type, hidden_from_chain, current_step)
      VALUES (?, ?, 'running', ?, 'mission', 0, 1)
    `).run(
      runningWorkflowId,
      'Agent Task — Running Workflow',
      JSON.stringify({ id: 'MANUAL-002', name: 'Running Workflow', steps: [] }),
    );

    db.prepare(`
      INSERT INTO tokens (id, workflow_id, action_type, resource_id, agent_id, minted_at, expires_at, status, context, parent_token_id, step_index, nonce)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      'tok_manual_mission',
      missionWorkflowId,
      'READ_OBJECT',
      'data/input.json',
      'agent-cloud-worker',
      new Date().toISOString(),
      new Date(Date.now() + 60000).toISOString(),
      'burned',
      JSON.stringify({}),
      null,
      0,
      'manual-nonce',
    );

    db.prepare(`
      INSERT INTO audit_log (token_id, workflow_id, event_type, details, timestamp, actor)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'tok_manual_mission',
      missionWorkflowId,
      'BURNED',
      JSON.stringify({ result: { stored: true } }),
      new Date().toISOString(),
      'agent',
    );

    const hiddenTestbench = workflowRunner.listWorkflows({ includeTestbench: true })
      .find((workflow) => workflow.workflow_type === 'testbench');

    const clearResult = workflowRunner.clearWorkflows({ workflowTypes: ['mission'] });
    const remainingMission = workflowRunner.listWorkflows();
    const allAfterClear = workflowRunner.listWorkflows({ includeTestbench: true });
    const archivedWorkflow = workflowRunner.getWorkflow(missionWorkflowId);
    const runningWorkflow = workflowRunner.getWorkflow(runningWorkflowId);

    assert.ok(clearResult.count >= 1, 'Expected at least one mission workflow to be cleared');
    assert.ok(remainingMission.some((workflow) => workflow.id === missionWorkflowId), 'Mission workflow should remain stored for audit context');
    assert.equal(archivedWorkflow.hidden_from_chain, 1, 'Completed mission workflow should be hidden from token chain');
    assert.equal(runningWorkflow.hidden_from_chain, 0, 'Running mission workflow should remain visible');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tokens WHERE workflow_id = ?').get(missionWorkflowId).count, 1, 'Mission tokens should be preserved');
    assert.equal(tokenEngine.getAuditLog(missionWorkflowId).length, 1, 'Mission audit log should remain intact');

    if (hiddenTestbench) {
      assert.ok(allAfterClear.some((workflow) => workflow.id === hiddenTestbench.id), 'Testbench workflow should remain stored');
    }
  });

  it('should clear only mission audit events when requested by security', () => {
    const db = getDb();
    const missionWorkflowId = 'wf_audit_mission';
    const testbenchWorkflowId = 'wf_audit_testbench';

    db.prepare(`
      INSERT INTO workflows (id, name, status, applicant_data, workflow_type, hidden_from_chain, current_step)
      VALUES (?, ?, 'completed', ?, ?, 0, 0)
    `).run(
      missionWorkflowId,
      'Agent Task — Audit Mission',
      JSON.stringify({ id: 'AUDIT-001', name: 'Audit Mission', steps: [] }),
      'mission',
    );

    db.prepare(`
      INSERT INTO workflows (id, name, status, applicant_data, workflow_type, hidden_from_chain, current_step)
      VALUES (?, ?, 'completed', ?, ?, 0, 0)
    `).run(
      testbenchWorkflowId,
      'Agent Task — Audit Testbench',
      JSON.stringify({ id: 'AUDIT-002', name: 'Audit Testbench', steps: [] }),
      'testbench',
    );

    db.prepare(`
      INSERT INTO audit_log (token_id, workflow_id, event_type, details, timestamp, actor)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('tok_audit_mission', missionWorkflowId, 'BURNED', JSON.stringify({}), new Date().toISOString(), 'agent');

    db.prepare(`
      INSERT INTO audit_log (token_id, workflow_id, event_type, details, timestamp, actor)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('tok_audit_testbench', testbenchWorkflowId, 'BURNED', JSON.stringify({}), new Date().toISOString(), 'agent');

    const missionBeforeClear = tokenEngine.getAuditLog(missionWorkflowId).length;
    const testbenchBeforeClear = tokenEngine.getAuditLog(testbenchWorkflowId).length;
    const result = tokenEngine.clearAuditLog({ workflowTypes: ['mission'] });

    assert.ok(result.count >= missionBeforeClear, 'Mission audit clear should remove mission rows');
    assert.equal(tokenEngine.getAuditLog(missionWorkflowId).length, 0, 'Mission audit log should be empty');
    assert.equal(tokenEngine.getAuditLog(testbenchWorkflowId).length, testbenchBeforeClear, 'Testbench audit log should remain intact');
  });
});

describe('Workflow Schema Validation', () => {
  it('should validate a correct workflow', () => {
    const result = validateWorkflow({
      name: 'Test Workflow',
      steps: [
        { action: 'READ_OBJECT', service: 'gcs', resource: 'data/input.json', actionVerb: 'read' },
      ],
    });
    assert.ok(result.valid, `Should be valid: ${result.errors.join(', ')}`);
  });

  it('should reject a workflow with no steps', () => {
    const result = validateWorkflow({ name: 'Bad', steps: [] });
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('non-empty')));
  });

  it('should reject unauthorized services', () => {
    const result = validateWorkflow({
      name: 'Bad',
      steps: [{ action: 'READ_OBJECT', service: 'source-control', resource: 'x', actionVerb: 'read' }],
    });
    assert.ok(!result.valid);
  });

  it('should reject action/verb mismatches', () => {
    const result = validateWorkflow({
      name: 'Bad',
      steps: [{ action: 'READ_OBJECT', service: 'gcs', resource: 'x', actionVerb: 'write' }],
    });
    assert.ok(!result.valid);
    assert.ok(result.errors.some(e => e.includes('does not match')));
  });

  it('should reject path traversal', () => {
    const result = validateWorkflow({
      name: 'Bad',
      steps: [{ action: 'READ_OBJECT', service: 'gcs', resource: '../../etc/passwd', actionVerb: 'read' }],
    });
    assert.ok(!result.valid);
  });

  it('should sanitize a workflow', () => {
    const sanitized = sanitizeWorkflow({
      name: 'Test',
      agent: 'evil-agent',
      malicious: true,
      steps: [{ action: 'READ_OBJECT', service: 'gcs', resource: 'data.json', actionVerb: 'read' }],
    });
    assert.equal(sanitized.agent, 'agent-cloud-worker', 'Agent should be overridden');
    assert.equal(sanitized.malicious, false, 'Malicious flag should be removed');
  });
});
