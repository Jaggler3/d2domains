import Stripe from "stripe";

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

export function createStripeProcessor(stripeSecretKey: string): PaymentProcessor {
  const stripe = new Stripe(stripeSecretKey);

  return {
    async charge({ amountCents, card }) {
      try {
        const intent = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: "usd",
          confirm: true,
          payment_method: card.token,
          automatic_payment_methods: {
            enabled: true,
          },
          description: `d2domains order charge for ${card.brand} ••${card.last4}`,
        });

        if (intent.status === "succeeded" || intent.status === "processing") {
          return { ok: true, ref: intent.id };
        }

        return {
          ok: false,
          failureReason: `payment intent ${intent.status}`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "stripe charge failed";
        return { ok: false, failureReason: message };
      }
    },
  };
}
