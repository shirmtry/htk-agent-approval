export const RUN_TYPES = ['dependency_bump', 'bulk_email', 'config_change'] as const;
export type RunType = (typeof RUN_TYPES)[number];

export const STEP_ORDER = ['validate', 'simulate', 'await_approval', 'apply', 'verify'] as const;
export type StepName = (typeof STEP_ORDER)[number];

export const MAX_ATTEMPTS = 3;
export const APPROVAL_TTL_HOURS = 24;

const CONFIG_KEYS = new Set([
  'checkout_enabled',
  'email_digest',
  'maintenance_mode',
  'rate_limit_per_min',
]);

export type RunPayload = Record<string, unknown>;

export type NormalizedPlan = {
  ok: boolean;
  errors: string[];
  payload: RunPayload;
  title: string;
  diff: string;
  risk: 'low' | 'medium' | 'high';
};

function isEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

export function planRun(type: RunType, raw: unknown): NormalizedPlan {
  const payload = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const errors: string[] = [];

  if (type === 'dependency_bump') {
    const name = String(payload.packageName ?? '').trim();
    const from = String(payload.fromVersion ?? '').trim();
    const to = String(payload.toVersion ?? '').trim();
    if (!/^[@a-z0-9/._-]{2,80}$/i.test(name)) errors.push('Tên package không hợp lệ.');
    if (!/^\d+\.\d+\.\d+$/.test(from)) errors.push('Phiên bản hiện tại phải dạng semver x.y.z.');
    if (!/^\d+\.\d+\.\d+$/.test(to)) errors.push('Phiên bản mới phải dạng semver x.y.z.');
    if (from === to) errors.push('Phiên bản mới phải khác phiên bản hiện tại.');
    const fromMajor = Number(from.split('.')[0]);
    const toMajor = Number(to.split('.')[0]);
    const risk = toMajor > fromMajor ? 'high' : toMajor < fromMajor ? 'high' : 'low';
    const diff =
      `--- package.json\n+++ package.json\n@@ dependencies @@\n` +
      `-  "${name}": "${from}"\n+  "${name}": "${to}"\n`;
    return {
      ok: errors.length === 0,
      errors,
      payload: { packageName: name, fromVersion: from, toVersion: to },
      title: `Bump ${name} ${from} → ${to}`,
      diff,
      risk,
    };
  }

  if (type === 'bulk_email') {
    const subject = String(payload.subject ?? '').trim();
    const body = String(payload.body ?? '').trim();
    const recipientsRaw = Array.isArray(payload.recipients) ? payload.recipients : [];
    const recipients = recipientsRaw.map((r) => String(r).trim()).filter(Boolean);
    if (subject.length < 2 || subject.length > 120) errors.push('Tiêu đề email cần 2–120 ký tự.');
    if (body.length < 10 || body.length > 2000) errors.push('Nội dung email cần 10–2.000 ký tự.');
    if (recipients.length < 1 || recipients.length > 5) errors.push('Cần 1–5 người nhận.');
    if (recipients.some((r) => !isEmail(r))) errors.push('Có địa chỉ email không hợp lệ.');
    const risk = recipients.length > 3 ? 'high' : 'medium';
    const diff =
      `--- outbox (sandbox)\n+++ outbox (sandbox)\n` +
      `+ to: ${recipients.join(', ')}\n+ subject: ${subject}\n` +
      body.split('\n').map((line) => `+ ${line}`).join('\n') +
      `\n`;
    return {
      ok: errors.length === 0,
      errors,
      payload: { subject, body, recipients },
      title: `Gửi email "${subject}" cho ${recipients.length} người`,
      diff,
      risk,
    };
  }

  const key = String(payload.key ?? '').trim();
  const value = String(payload.value ?? '').trim();
  if (!CONFIG_KEYS.has(key)) errors.push(`Config key phải thuộc allowlist: ${[...CONFIG_KEYS].join(', ')}.`);
  if (!value || value.length > 100) errors.push('Giá trị config cần 1–100 ký tự.');
  const diff =
    `--- config.json\n+++ config.json\n` +
    `-  "${key}": "<current>"\n+  "${key}": "${value}"\n`;
  return {
    ok: errors.length === 0,
    errors,
    payload: { key, value },
    title: `Đổi config ${key} → ${value}`,
    diff,
    risk: key === 'maintenance_mode' ? 'high' : 'low',
  };
}

export function stepAfter(step: StepName): StepName | 'completed' {
  const index = STEP_ORDER.indexOf(step);
  if (index < 0 || index === STEP_ORDER.length - 1) return 'completed';
  return STEP_ORDER[index + 1];
}

export function shouldRetry(attempts: number): boolean {
  return attempts < MAX_ATTEMPTS;
}

export function isExpired(expiresAt: string | Date, now = Date.now()): boolean {
  return new Date(expiresAt).getTime() < now;
}

export function isTerminal(status: string): boolean {
  return ['completed', 'rejected', 'failed', 'expired'].includes(status);
}

export function nextAction(status: string, currentStep: string): string {
  if (isTerminal(status)) return 'none';
  if (status === 'awaiting_approval') return 'wait_for_human';
  if (status === 'approved') return 'resume_worker';
  if (status === 'paused') return 'resume_worker';
  if (currentStep === 'await_approval') return 'wait_for_human';
  return 'worker_tick';
}
