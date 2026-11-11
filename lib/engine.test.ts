import { describe, expect, it } from 'vitest';
import {
  isExpired,
  isTerminal,
  MAX_ATTEMPTS,
  nextAction,
  planRun,
  shouldRetry,
  stepAfter,
} from './engine';

describe('planRun', () => {
  it('builds a dependency diff and flags a major bump as high risk', () => {
    const plan = planRun('dependency_bump', {
      packageName: 'next',
      fromVersion: '15.5.0',
      toVersion: '16.0.0',
    });
    expect(plan.ok).toBe(true);
    expect(plan.diff).toContain('-  "next": "15.5.0"');
    expect(plan.diff).toContain('+  "next": "16.0.0"');
    expect(plan.risk).toBe('high');
  });

  it('rejects invalid semver and equal versions', () => {
    const plan = planRun('dependency_bump', {
      packageName: 'react',
      fromVersion: '19.0.0',
      toVersion: '19.0.0',
    });
    expect(plan.ok).toBe(false);
    expect(plan.errors.length).toBeGreaterThan(0);
  });

  it('limits bulk email recipients to five and validates addresses', () => {
    const tooMany = planRun('bulk_email', {
      subject: 'Release notes',
      body: 'This is the release note body.',
      recipients: ['a@b.co', 'c@d.co', 'e@f.co', 'g@h.co', 'i@j.co', 'k@l.co'],
    });
    expect(tooMany.ok).toBe(false);
    const badEmail = planRun('bulk_email', {
      subject: 'Release notes',
      body: 'This is the release note body.',
      recipients: ['not-an-email'],
    });
    expect(badEmail.ok).toBe(false);
  });

  it('enforces the config allowlist', () => {
    expect(planRun('config_change', { key: 'secret_key', value: 'x' }).ok).toBe(false);
    expect(planRun('config_change', { key: 'checkout_enabled', value: 'false' }).ok).toBe(true);
  });
});

describe('state machine helpers', () => {
  it('advances steps in order and ends completed', () => {
    expect(stepAfter('validate')).toBe('simulate');
    expect(stepAfter('simulate')).toBe('await_approval');
    expect(stepAfter('await_approval')).toBe('apply');
    expect(stepAfter('apply')).toBe('verify');
    expect(stepAfter('verify')).toBe('completed');
  });

  it('caps retries at three attempts', () => {
    expect(shouldRetry(0)).toBe(true);
    expect(shouldRetry(MAX_ATTEMPTS - 1)).toBe(true);
    expect(shouldRetry(MAX_ATTEMPTS)).toBe(false);
  });

  it('treats expired approvals and terminal states correctly', () => {
    expect(isExpired(new Date(Date.now() - 1000).toISOString())).toBe(true);
    expect(isExpired(new Date(Date.now() + 60_000).toISOString())).toBe(false);
    expect(isTerminal('completed')).toBe(true);
    expect(isTerminal('awaiting_approval')).toBe(false);
    expect(nextAction('awaiting_approval', 'await_approval')).toBe('wait_for_human');
    expect(nextAction('running', 'apply')).toBe('worker_tick');
  });
});
