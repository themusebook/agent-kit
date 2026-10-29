import type { PaymentRequirement } from "./x402";

/**
 * x402m mailbox client (store-and-forward agent messaging).
 *
 * INVARIANT (typed into this module on purpose): messages carry PROPOSALS
 * and CLAIMS, never spending authority. A `payment.request` is a quote —
 * accepting it in conversation moves no funds; settlement always happens
 * through an x402 scheme and is verified independently by the recipient.
 * Messaging credentials can never authorize payments.
 *
 * ASSUMPTION: operations are POSTs against the descriptor endpoint
 * ({endpoint}/register|send|inbox|ack) with the agent token in an
 * `authorization: Bearer` header, per the x402m/1 reference deployment.
 */

export type MessageKind =
  | "request"
  | "response"
  | "event"
  | "error"
  | "payment.request"
  | "payment.receipt";

export interface MailboxMessage {
  id?: string;
  to: string;
  from?: string;
  kind: MessageKind;
  content: string;
  conversationId?: string;
  replyTo?: string;
  /** Content profile id (`<name>/v<major>`) the content follows. */
  contentProfile?: string;
  state?: "accepted" | "delivered" | "read";
}

/** A payment REQUEST is a proposal referencing PaymentRequirements — not a charge. */
export interface PaymentRequestContent {
  requirement: PaymentRequirement;
  note?: string;
}

/** A payment RECEIPT is a claim; recipients MUST verify settlement independently. */
export interface PaymentReceiptContent {
  transaction: string;
  network: string;
}

export interface MailboxClientOptions {
  /** Mailbox execute endpoint (from the x402m discovery descriptor). */
  endpoint: string;
  /** Async source of short-lived agent tokens (scoped to messaging only). */
  getAgentToken: () => Promise<string>;
}

export class MailboxClient {
  private readonly endpoint: string;
  private readonly getAgentToken: () => Promise<string>;

  constructor(options: MailboxClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.getAgentToken = options.getAgentToken;
  }

  private async call<T>(path: string, body?: unknown): Promise<T> {
    const token = await this.getAgentToken();
    const res = await fetch(`${this.endpoint}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`x402m ${path} failed: HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** Send a message; resolves with the stored message id + state "accepted" (= stored, not read). */
  async send(message: MailboxMessage): Promise<{ id: string; state: string }> {
    return this.call("/send", message);
  }

  /** A quote/proposal to another agent. Moves NO funds. */
  async sendPaymentRequest(
    to: string,
    content: PaymentRequestContent,
    options: { contentProfile?: string; conversationId?: string } = {},
  ): Promise<{ id: string; state: string }> {
    return this.send({
      to,
      kind: "payment.request",
      content: JSON.stringify(content),
      contentProfile: options.contentProfile,
      conversationId: options.conversationId,
    });
  }

  /** A settlement CLAIM. The recipient verifies it independently. */
  async sendPaymentReceipt(
    to: string,
    content: PaymentReceiptContent,
    options: { replyTo?: string; conversationId?: string } = {},
  ): Promise<{ id: string; state: string }> {
    return this.send({
      to,
      kind: "payment.receipt",
      content: JSON.stringify(content),
      replyTo: options.replyTo,
      conversationId: options.conversationId,
    });
  }

  async inbox(limit = 25): Promise<MailboxMessage[]> {
    const body = await this.call<{ messages?: MailboxMessage[] } | MailboxMessage[]>(
      "/inbox",
      { limit },
    );
    return Array.isArray(body) ? body : (body.messages ?? []);
  }

  async ack(messageId: string): Promise<void> {
    await this.call("/ack", { messageId });
  }
}
