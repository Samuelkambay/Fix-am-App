import type { FixamApi } from './api';
import { newIdempotencyKey, sleep } from './client';
import { ApiError } from './errors';
import { readJson, writeJson, type KeyValueStore } from './storage';
import type { CreatePaymentBody, GatewayCode, Payment, PaymentState } from './types';

export type PaymentPhase =
  | 'idle'
  | 'creating' // POST /payments in flight (or being retried after a timeout)
  | 'waiting' // payer must approve on their phone; polling GET /payments/:id
  | 'succeeded'
  | 'failed'
  | 'expired'
  | 'error'; // could not start (validation, wrong network, offline...)

export interface PaymentSnapshot {
  phase: PaymentPhase;
  payment: Payment | null;
  error: ApiError | Error | null;
  /** Set on 400 wallet_network_mismatch: the wallet that matches the number's network. */
  suggestedGateway: GatewayCode | null;
  /** True while the last poll failed for lack of connection (we keep trying). */
  offline: boolean;
  idempotencyKey: string | null;
  attempt: number;
}

export const FINAL_PAYMENT_STATES: PaymentState[] = ['succeeded', 'failed', 'expired', 'refunded'];

export function isFinalPayment(p: Payment | null | undefined): boolean {
  return !!p && FINAL_PAYMENT_STATES.includes(p.status);
}

interface SavedAttempt {
  key: string;
  bodyHash: string;
  paymentId: string | null;
  savedAt: number;
}

export interface PaymentSessionOptions {
  /** Poll interval while waiting for the payer. Default 3 s. */
  pollIntervalMs?: number;
  /** Stop polling after this long (server-side payments expire after 15 min). Default 16 min. */
  maxWaitMs?: number;
  onChange?: (s: PaymentSnapshot) => void;
  /**
   * Persist the current attempt (Idempotency-Key + payment id) so a retry after the app was killed
   * mid-payment reuses the same key instead of charging again.
   */
  store?: KeyValueStore;
  /** Storage slot, e.g. `pay:booking:<id>`. Required with `store`. */
  storeKey?: string;
}

function hashBody(b: CreatePaymentBody): string {
  return JSON.stringify(b, Object.keys(b).sort());
}

/**
 * One payment flow (one booking, one top-up, ...). Rules:
 *  - Each attempt gets an Idempotency-Key. Retrying the same attempt (timeouts, 5xx, app restart) reuses it.
 *  - A new key is used only when the previous attempt definitively failed/expired or the payer changes wallet/number.
 *  - 409 payment_in_progress: resume the payment that is already waiting instead of starting another.
 */
export class PaymentSession {
  private api: FixamApi;
  private opts: Required<Pick<PaymentSessionOptions, 'pollIntervalMs' | 'maxWaitMs'>> & PaymentSessionOptions;
  private snap: PaymentSnapshot = { phase: 'idle', payment: null, error: null, suggestedGateway: null, offline: false, idempotencyKey: null, attempt: 0 };
  private current: SavedAttempt | null = null;
  private lastBody: CreatePaymentBody | null = null;
  private pollToken = 0;
  private loaded = false;

  constructor(api: FixamApi, opts: PaymentSessionOptions = {}) {
    this.api = api;
    this.opts = { pollIntervalMs: 3000, maxWaitMs: 16 * 60_000, ...opts };
  }

  get snapshot(): PaymentSnapshot {
    return this.snap;
  }

  private emit(patch: Partial<PaymentSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.opts.onChange?.(this.snap);
  }

  private async loadSaved() {
    if (this.loaded) return;
    this.loaded = true;
    if (this.opts.store && this.opts.storeKey) {
      const saved = await readJson<SavedAttempt>(this.opts.store, this.opts.storeKey);
      // Older than the server's 15-minute payment window: start fresh.
      if (saved && Date.now() - saved.savedAt < 20 * 60_000) this.current = saved;
    }
  }

  private async save() {
    if (this.opts.store && this.opts.storeKey) await writeJson(this.opts.store, this.opts.storeKey, this.current);
  }

  /** Resumes a payment left waiting (e.g. the app was closed while the payer approved). */
  async resumeSaved(): Promise<PaymentSnapshot | null> {
    await this.loadSaved();
    if (!this.current?.paymentId) return null;
    try {
      const p = await this.api.payments.get(this.current.paymentId);
      this.emit({ payment: p, idempotencyKey: this.current.key });
      if (!isFinalPayment(p)) return this.poll(p);
      return this.finish(p);
    } catch {
      return null;
    }
  }

  /** Starts (or safely retries) a payment for `body`. Resolves once the payment is final or could not start. */
  async start(body: CreatePaymentBody): Promise<PaymentSnapshot> {
    await this.loadSaved();
    this.stopPolling();
    const bodyHash = hashBody(body);
    const reuse =
      this.current &&
      this.current.bodyHash === bodyHash &&
      // A definitive failure needs a fresh key; anything uncertain reuses the old one.
      !(this.snap.payment && this.snap.payment.idempotency_key === this.current.key && isFinalPayment(this.snap.payment));
    if (!reuse) {
      this.current = { key: newIdempotencyKey('pay'), bodyHash, paymentId: null, savedAt: Date.now() };
      this.emit({ attempt: this.snap.attempt + 1 });
    }
    this.lastBody = body;
    await this.save();
    this.emit({ phase: 'creating', error: null, suggestedGateway: null, offline: false, idempotencyKey: this.current!.key });

    let payment: Payment;
    try {
      payment = await this.api.payments.create(body, this.current!.key, { retries: 2 });
    } catch (e) {
      return this.handleCreateError(e, body);
    }
    this.current = { ...this.current!, paymentId: payment.id, savedAt: Date.now() };
    await this.save();
    this.emit({ payment });
    if (isFinalPayment(payment)) return this.finish(payment);
    return this.poll(payment);
  }

  /** Same attempt again: reuses the key unless the last payment definitively failed or expired. */
  retry(): Promise<PaymentSnapshot> {
    if (!this.lastBody) throw new Error('Nothing to retry');
    return this.start(this.lastBody);
  }

  private async handleCreateError(e: unknown, body: CreatePaymentBody): Promise<PaymentSnapshot> {
    if (e instanceof ApiError) {
      if (e.code === 'payment_in_progress') {
        const id = (e.details as { paymentId?: string } | undefined)?.paymentId;
        if (id) {
          try {
            const p = await this.api.payments.get(id);
            this.current = { key: p.idempotency_key, bodyHash: hashBody(body), paymentId: p.id, savedAt: Date.now() };
            await this.save();
            this.emit({ payment: p, idempotencyKey: p.idempotency_key });
            return isFinalPayment(p) ? this.finish(p) : this.poll(p);
          } catch {
            // fall through to the error state
          }
        }
      }
      if (e.code === 'idempotency_key_reused') {
        // The stored key belonged to a different payment (e.g. amount changed). Start a clean attempt.
        this.current = null;
        await this.save();
        return this.start(body);
      }
      if (e.code === 'wallet_network_mismatch') {
        const s = (e.details as { suggestedGateway?: GatewayCode } | undefined)?.suggestedGateway ?? null;
        this.emit({ phase: 'error', error: e, suggestedGateway: s });
        return this.snap;
      }
    }
    // Keep `current` so a retry after a timeout reuses the same key.
    this.emit({ phase: 'error', error: e instanceof Error ? e : new Error(String(e)) });
    return this.snap;
  }

  private async poll(initial: Payment): Promise<PaymentSnapshot> {
    const token = ++this.pollToken;
    this.emit({ phase: 'waiting', payment: initial });
    const deadline = Date.now() + this.opts.maxWaitMs;
    let p = initial;
    while (token === this.pollToken) {
      await sleep(this.opts.pollIntervalMs);
      if (token !== this.pollToken) break;
      try {
        p = await this.api.payments.get(p.id);
        this.emit({ payment: p, offline: false });
        if (isFinalPayment(p)) return this.finish(p);
      } catch (e) {
        if (e instanceof ApiError && e.isNetwork) this.emit({ offline: true });
        else if (e instanceof ApiError && e.status === 404) {
          this.emit({ phase: 'error', error: e });
          return this.snap;
        }
      }
      if (Date.now() > deadline) {
        this.emit({ phase: 'expired' });
        return this.snap;
      }
    }
    return this.snap;
  }

  private async finish(p: Payment): Promise<PaymentSnapshot> {
    const phase: PaymentPhase = p.status === 'succeeded' || p.status === 'refunded' ? 'succeeded' : p.status === 'expired' ? 'expired' : 'failed';
    if (phase === 'succeeded') {
      this.current = null;
      await this.save();
    }
    this.emit({ phase, payment: p, offline: false });
    return this.snap;
  }

  /** Sandbox: play the operator and approve (or decline) right away. Polling picks up the result. */
  async simulate(outcome?: 'succeeded' | 'failed') {
    const p = this.snap.payment;
    if (!p) throw new Error('No payment to simulate');
    const res = await this.api.payments.simulate(p.id, outcome);
    this.emit({ payment: res.payment });
    return res;
  }

  /** Stops polling (screen closed). The payment itself carries on at the operator. */
  stopPolling() {
    this.pollToken++;
  }

  /** Forget the attempt, e.g. when the payer picks another wallet. */
  async reset() {
    this.stopPolling();
    this.current = null;
    this.lastBody = null;
    await this.save();
    this.emit({ phase: 'idle', payment: null, error: null, suggestedGateway: null, offline: false, idempotencyKey: null });
  }
}

/** Human text for a gateway failure_reason. */
export function failureReasonText(reason: string | null | undefined): string {
  switch (reason) {
    case 'insufficient_funds':
      return 'Not enough money in the wallet.';
    case 'declined_by_payer':
      return 'The payment was declined on the phone.';
    case 'payer_did_not_approve':
      return 'The PIN was not entered in time.';
    case 'gateway_error':
      return 'The mobile money service did not respond.';
    case null:
    case undefined:
      return 'The payment did not go through.';
    default:
      return reason.replace(/_/g, ' ');
  }
}
