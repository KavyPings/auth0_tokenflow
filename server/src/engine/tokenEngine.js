import { v4 as uuidv4 } from 'uuid';
import { getDb } from '../db/database.js';
import { broadcast } from '../websocket/wsServer.js';

const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

class TokenEngine {
  // ─── Mint a new capability token ──────────────────────────
  mintToken(workflowId, actionType, resourceId, agentId, context = {}, parentTokenId = null, stepIndex = 0) {
    const db = getDb();
    const id = `tok_${uuidv4().slice(0, 12)}`;
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

    db.prepare(`
      INSERT INTO tokens (id, workflow_id, action_type, resource_id, agent_id, minted_at, expires_at, status, context, parent_token_id, step_index)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    `).run(id, workflowId, actionType, resourceId, agentId, now, expiresAt, JSON.stringify(context), parentTokenId, stepIndex);

    this._auditLog(id, workflowId, 'MINTED', { actionType, resourceId, parentTokenId }, 'system');

    broadcast({
      type: 'TOKEN_EVENT',
      payload: {
        event: 'MINTED',
        token: this.getToken(id),
        timestamp: now,
      },
    });

    console.log(`[TOKEN] Minted ${id} — ${actionType} (step ${stepIndex})`);
    return this.getToken(id);
  }

  // ─── Activate a pending token ─────────────────────────────
  activateToken(tokenId) {
    const db = getDb();
    const token = this.getToken(tokenId);
    if (!token) throw new Error(`Token ${tokenId} not found`);
    if (token.status !== 'pending') throw new Error(`Token ${tokenId} is ${token.status}, cannot activate`);

    db.prepare(`UPDATE tokens SET status = 'active' WHERE id = ?`).run(tokenId);
    this._auditLog(tokenId, token.workflow_id, 'ACTIVATED', {}, 'system');

    broadcast({
      type: 'TOKEN_EVENT',
      payload: {
        event: 'ACTIVATED',
        token: this.getToken(tokenId),
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[TOKEN] Activated ${tokenId}`);
    return this.getToken(tokenId);
  }

  // ─── Consume (burn) a token after action execution ───────
  consumeToken(tokenId, result = {}) {
    const db = getDb();
    const token = this.getToken(tokenId);
    if (!token) throw new Error(`Token ${tokenId} not found`);
    if (token.status !== 'active') throw new Error(`Token ${tokenId} is ${token.status}, cannot consume`);

    // Check expiration
    if (new Date(token.expires_at) < new Date()) {
      db.prepare(`UPDATE tokens SET status = 'revoked' WHERE id = ?`).run(tokenId);
      this._auditLog(tokenId, token.workflow_id, 'EXPIRED', {}, 'system');
      throw new Error(`Token ${tokenId} has expired`);
    }

    const baseContext = typeof token.context === 'string'
      ? JSON.parse(token.context || '{}')
      : (token.context || {});
    const updatedContext = { ...baseContext, result };
    db.prepare(`UPDATE tokens SET status = 'burned', context = ? WHERE id = ?`).run(JSON.stringify(updatedContext), tokenId);
    this._auditLog(tokenId, token.workflow_id, 'BURNED', { result }, 'agent');

    broadcast({
      type: 'TOKEN_EVENT',
      payload: {
        event: 'BURNED',
        token: this.getToken(tokenId),
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[TOKEN] Burned ${tokenId}`);
    return this.getToken(tokenId);
  }

  // ─── Revoke a token ──────────────────────────────────────
  revokeToken(tokenId, reason = 'Manual revocation', actor = 'human') {
    const db = getDb();
    const token = this.getToken(tokenId);
    if (!token) throw new Error(`Token ${tokenId} not found`);
    if (token.status === 'burned' || token.status === 'revoked') {
      throw new Error(`Token ${tokenId} is already ${token.status}`);
    }

    db.prepare(`UPDATE tokens SET status = 'revoked' WHERE id = ?`).run(tokenId);
    this._auditLog(tokenId, token.workflow_id, 'REVOKED', { reason }, actor);

    broadcast({
      type: 'TOKEN_EVENT',
      payload: {
        event: 'REVOKED',
        token: this.getToken(tokenId),
        reason,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[TOKEN] Revoked ${tokenId} — ${reason}`);
    return this.getToken(tokenId);
  }

  // ─── Flag a token (security violation) ────────────────────
  flagToken(tokenId, flagType, details = {}) {
    const db = getDb();
    const token = this.getToken(tokenId);
    if (!token) throw new Error(`Token ${tokenId} not found`);

    db.prepare(`UPDATE tokens SET status = 'flagged' WHERE id = ?`).run(tokenId);
    this._auditLog(tokenId, token.workflow_id, 'FLAGGED', { flagType, ...details }, 'system');

    broadcast({
      type: 'TOKEN_EVENT',
      payload: {
        event: 'FLAGGED',
        token: this.getToken(tokenId),
        flagType,
        details,
        timestamp: new Date().toISOString(),
      },
    });

    // Security violation event for human review panel
    broadcast({
      type: 'SECURITY_VIOLATION',
      payload: {
        tokenId,
        workflowId: token.workflow_id,
        flagType,
        details,
        timestamp: new Date().toISOString(),
      },
    });

    console.log(`[TOKEN] Flagged ${tokenId} — ${flagType}`);
    return this.getToken(tokenId);
  }

  // ─── Kill switch: revoke all active/pending tokens ───────
  revokeAllActive(workflowId) {
    const db = getDb();
    const tokens = db.prepare(`
      SELECT id FROM tokens WHERE workflow_id = ? AND status IN ('pending', 'active', 'flagged')
    `).all(workflowId);

    for (const token of tokens) {
      this.revokeToken(token.id, 'Kill switch activated', 'human');
    }

    console.log(`[TOKEN] Kill switch: revoked ${tokens.length} tokens for workflow ${workflowId}`);
    return tokens.length;
  }

  // ─── Query helpers ────────────────────────────────────────
  getToken(tokenId) {
    const db = getDb();
    const token = db.prepare('SELECT * FROM tokens WHERE id = ?').get(tokenId);
    if (token && token.context) {
      try { token.context = JSON.parse(token.context); } catch { /* keep as string */ }
    }
    return token;
  }

  getTokenChain(workflowId) {
    const db = getDb();
    const tokens = db.prepare('SELECT * FROM tokens WHERE workflow_id = ? ORDER BY step_index ASC').all(workflowId);
    return tokens.map(t => {
      if (t.context) {
        try { t.context = JSON.parse(t.context); } catch { /* keep as string */ }
      }
      return t;
    });
  }

  getAuditLog(workflowId = null) {
    const db = getDb();
    let rows;
    if (workflowId) {
      rows = db.prepare('SELECT * FROM audit_log WHERE workflow_id = ? ORDER BY id ASC').all(workflowId);
    } else {
      rows = db.prepare('SELECT * FROM audit_log ORDER BY id ASC').all();
    }
    return rows.map(r => {
      if (r.details) {
        try { r.details = JSON.parse(r.details); } catch { /* keep as string */ }
      }
      return r;
    });
  }

  // ─── Internal: write immutable audit log entry ───────────
  _auditLog(tokenId, workflowId, eventType, details = {}, actor = 'system') {
    const db = getDb();
    const timestamp = new Date().toISOString();

    db.prepare(`
      INSERT INTO audit_log (token_id, workflow_id, event_type, details, timestamp, actor)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(tokenId, workflowId, eventType, JSON.stringify(details), timestamp, actor);

    broadcast({
      type: 'AUDIT_EVENT',
      payload: {
        token_id: tokenId,
        workflow_id: workflowId,
        event_type: eventType,
        details,
        timestamp,
        actor,
      },
    });
  }
}

export const tokenEngine = new TokenEngine();
