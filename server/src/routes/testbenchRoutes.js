// ═══════════════════════════════════════════════════════════
// Testbench Routes — API endpoints for the security testbench
// ═══════════════════════════════════════════════════════════

import { Router } from 'express';
import { testbenchEngine } from '../engine/testbenchEngine.js';
import { INVARIANT_COUNT } from '../engine/testbenchAssertions.js';

const router = Router();

// ─── POST /api/testbench/run ─────────────────────────────
// Run a single scenario as a test
router.post('/run', async (req, res) => {
  try {
    const { scenarioId } = req.body;
    if (!scenarioId) {
      return res.status(400).json({ error: 'Missing scenarioId' });
    }

    const result = await testbenchEngine.runScenario(scenarioId);
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── POST /api/testbench/run-suite ───────────────────────
// Run all scenarios
router.post('/run-suite', async (req, res) => {
  try {
    const result = await testbenchEngine.runSuite();
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ─── GET /api/testbench/scenarios ────────────────────────
// List available test scenarios
router.get('/scenarios', (req, res) => {
  const scenarios = testbenchEngine.getScenarios();
  res.json({
    success: true,
    scenarios,
    count: scenarios.length,
    meta: {
      scenarioCount: scenarios.length,
      invariantCount: INVARIANT_COUNT,
    },
  });
});

// ─── GET /api/testbench/results ──────────────────────────
// Get recent test results
router.get('/results', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const results = testbenchEngine.getResults(limit);
  res.json({ success: true, results, count: results.length });
});

// ─── GET /api/testbench/results/:id ──────────────────────
// Get a specific test run result
router.get('/results/:id', (req, res) => {
  const result = testbenchEngine.getResult(req.params.id);
  if (!result) {
    return res.status(404).json({ error: 'Test run not found' });
  }
  res.json({ success: true, result });
});

export default router;
