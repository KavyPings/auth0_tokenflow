// ═══════════════════════════════════════════════════════════
// Upload Routes — Workflow upload, templates, and schema
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database.js';
import { validateWorkflow, sanitizeWorkflow, getTemplates, WORKFLOW_SCHEMA } from '../engine/workflowSchema.js';
import { workflowRunner } from '../engine/workflowRunner.js';

const router = Router();

// ─── POST /api/workflows/upload ──────────────────────────
// Validate and store a workflow definition
router.post('/upload', (req, res) => {
  try {
    const { definition } = req.body;
    if (!definition) {
      return res.status(400).json({ error: 'Missing workflow definition in request body' });
    }

    const validation = validateWorkflow(definition);
    const sanitized = validation.valid ? sanitizeWorkflow(definition) : null;
    const storedDefinition = sanitized || definition;
    const id = `uwf_${uuidv4().slice(0, 12)}`;
    const now = new Date().toISOString();
    const normalizedName = String(storedDefinition?.name || 'Untitled Workflow').slice(0, 100).trim() || 'Untitled Workflow';
    const normalizedDescription = String(storedDefinition?.description || '').slice(0, 500).trim();
    const status = validation.valid ? 'validated' : 'invalid';
    const lastError = validation.valid ? '' : 'Workflow definition failed validation';

    const db = getDb();
    db.prepare(`
      INSERT INTO uploaded_workflows (id, name, description, definition, status, validation_errors, last_error, uploaded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      normalizedName,
      normalizedDescription,
      JSON.stringify(storedDefinition),
      status,
      JSON.stringify(validation.errors || []),
      lastError,
      now
    );

    res.status(201).json({
      success: validation.valid,
      stored: true,
      id,
      name: normalizedName,
      description: normalizedDescription,
      steps: storedDefinition?.steps || [],
      status,
      validation,
      errors: validation.errors,
      message: validation.valid
        ? 'Workflow uploaded and validated successfully'
        : 'Workflow stored, but validation failed',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /api/workflows/upload/:id/run ──────────────────
// Run an uploaded workflow
router.post('/upload/:id/run', async (req, res) => {
  try {
    const db = getDb();
    const uploaded = db.prepare('SELECT * FROM uploaded_workflows WHERE id = ?').get(req.params.id);
    if (!uploaded) {
      return res.status(404).json({ error: 'Uploaded workflow not found' });
    }

    const definition = JSON.parse(uploaded.definition);
    const validation = validateWorkflow(definition);
    const now = new Date().toISOString();

    if (!validation.valid) {
      db.prepare(`
        UPDATE uploaded_workflows
        SET status = 'invalid', validation_errors = ?, last_error = ?, last_run_at = ?
        WHERE id = ?
      `).run(
        JSON.stringify(validation.errors),
        'Workflow definition failed validation',
        now,
        uploaded.id
      );

      return res.status(400).json({
        error: 'VALIDATION_FAILED',
        message: 'Stored workflow is invalid and cannot be executed until it is fixed.',
        errors: validation.errors,
        workflow: serializeUploadedWorkflow({
          ...uploaded,
          status: 'invalid',
          validation_errors: JSON.stringify(validation.errors),
          last_error: 'Workflow definition failed validation',
          last_run_at: now,
        }),
      });
    }

    const sanitized = sanitizeWorkflow(definition);
    const taskData = {
      id: uploaded.id,
      name: sanitized.name,
      description: sanitized.description,
      agent: sanitized.agent || 'agent-cloud-worker',
      malicious: false,
      steps: sanitized.steps,
    };

    try {
      const result = await workflowRunner.startWorkflow(taskData);
      db.prepare(`
        UPDATE uploaded_workflows
        SET status = 'validated', validation_errors = '[]', last_error = '', last_run_at = ?
        WHERE id = ?
      `).run(now, uploaded.id);

      res.status(201).json({ success: true, ...result });
    } catch (error) {
      db.prepare(`
        UPDATE uploaded_workflows
        SET status = 'run_failed', validation_errors = '[]', last_error = ?, last_run_at = ?
        WHERE id = ?
      `).run(error.message, now, uploaded.id);

      res.status(400).json({
        error: 'RUN_FAILED',
        message: error.message,
        workflow: serializeUploadedWorkflow({
          ...uploaded,
          status: 'run_failed',
          validation_errors: '[]',
          last_error: error.message,
          last_run_at: now,
        }),
      });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/upload/:id', (req, res) => {
  try {
    const db = getDb();
    const uploaded = db.prepare('SELECT * FROM uploaded_workflows WHERE id = ?').get(req.params.id);
    if (!uploaded) {
      return res.status(404).json({ error: 'Uploaded workflow not found' });
    }

    const deleteWorkflow = db.prepare('DELETE FROM uploaded_workflows WHERE id = ?');
    const deleteTestRuns = db.prepare('DELETE FROM test_runs WHERE scenario_id = ?');
    const deletedTestRuns = db.prepare('SELECT COUNT(*) AS count FROM test_runs WHERE scenario_id = ?').get(req.params.id).count;

    db.transaction(() => {
      deleteTestRuns.run(req.params.id);
      deleteWorkflow.run(req.params.id);
    })();

    res.json({
      success: true,
      id: req.params.id,
      deletedTestRuns,
      message: 'Uploaded workflow removed.',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /api/workflows/upload ───────────────────────────
// List all uploaded workflows
router.get('/upload', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM uploaded_workflows ORDER BY uploaded_at DESC').all();
  const workflows = rows.map((row) => serializeUploadedWorkflow(row));
  res.json({ success: true, workflows, count: workflows.length });
});

// ─── GET /api/workflows/templates ────────────────────────
// Return starter templates
router.get('/templates', (req, res) => {
  res.json({ success: true, templates: getTemplates() });
});

// ─── GET /api/workflows/schema ───────────────────────────
// Return the JSON schema for client-side validation
router.get('/schema', (req, res) => {
  res.json({ success: true, schema: WORKFLOW_SCHEMA });
});

function serializeUploadedWorkflow(row) {
  const normalized = { ...row };

  try {
    normalized.definition = JSON.parse(normalized.definition);
  } catch {
    normalized.definition = null;
  }

  try {
    normalized.validation_errors = JSON.parse(normalized.validation_errors || '[]');
  } catch {
    normalized.validation_errors = [];
  }

  normalized.isRunnable = normalized.status !== 'invalid';
  return normalized;
}

export default router;
