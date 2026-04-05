import { Router } from 'express';
import { tokenEngine } from '../engine/tokenEngine.js';
import { policyEngine } from '../engine/policyEngine.js';
import { requireTokenById } from '../middleware/tokenMiddleware.js';

const router = Router();

router.post('/mint', (req, res) => {
  try {
    const { workflowId, actionType, resourceId, agentId, context, parentTokenId, stepIndex } = req.body;

    if (!workflowId || !actionType || !agentId) {
      return res.status(400).json({
        error: 'Missing required fields: workflowId, actionType, agentId',
      });
    }

    const policy = policyEngine.canMint(actionType, context);
    if (!policy.allowed) {
      return res.status(403).json({
        error: 'POLICY_DENIED',
        reason: policy.reason,
      });
    }

    const token = tokenEngine.mintToken(
      workflowId,
      actionType,
      resourceId,
      agentId,
      context,
      parentTokenId,
      stepIndex || 0
    );

    res.status(201).json({
      success: true,
      token,
      requiresStepUp: policy.requiresStepUp || false,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/consume/:id', requireTokenById('id'), (req, res) => {
  try {
    const { result } = req.body || {};
    const token = tokenEngine.consumeToken(req.params.id, result);
    res.json({ success: true, token });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/revoke/:id', (req, res) => {
  try {
    const { reason, actor } = req.body || {};
    const token = tokenEngine.revokeToken(req.params.id, reason || 'Manual revocation', actor || 'human');
    res.json({ success: true, token });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/audit', (req, res) => {
  const { workflowId } = req.query;
  const log = tokenEngine.getAuditLog(workflowId || null);
  res.json({ success: true, audit_log: log, count: log.length });
});

router.post('/audit/clear', (req, res) => {
  try {
    const result = tokenEngine.clearAuditLog({ workflowTypes: ['mission'] });
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/chain/:workflowId', (req, res) => {
  const chain = tokenEngine.getTokenChain(req.params.workflowId);
  res.json({ success: true, chain, count: chain.length });
});

router.get('/workflow/:workflowId', (req, res) => {
  const chain = tokenEngine.getTokenChain(req.params.workflowId);
  const summary = chain.reduce((acc, token) => {
    acc[token.status] = (acc[token.status] || 0) + 1;
    return acc;
  }, {});

  res.json({
    success: true,
    workflowId: req.params.workflowId,
    summary,
    chain,
  });
});

router.get('/:id', (req, res) => {
  const token = tokenEngine.getToken(req.params.id);
  if (!token) {
    return res.status(404).json({ error: 'Token not found' });
  }
  res.json({ success: true, token });
});

export default router;
