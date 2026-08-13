export interface PaymentCard {
  token: string;
  brand: string;
  last4: string;
}

export interface ProcessorResult {
  ok: boolean;
  failureReason?: string;
  ref?: string;
}

export interface PaymentProcessor {
  charge(input: { amountCents: number; card: PaymentCard }): Promise<ProcessorResult>;
}

export function createFakeProcessor(failMinCents: number): PaymentProcessor {
  return {
    async charge({ amountCents, card }) {
      if (failMinCents > 0 && amountCents >= failMinCents) {
        return {
          ok: false,
          failureReason: `card declined (test rule: >= $${(failMinCents / 100).toFixed(2)})`,
        };
      }
      return {
        ok: true,
        ref: `fake_${card.token}_${crypto.randomUUID()}`,
      };
    },
  };
}
