// Stripe Connect and transfers. Owned by WS5: `transfer` keeps today's behaviour; the new-contract methods
// (docs/contracts.md 4.4) are stubs until WS5 implements them.

import { AccountStatus, ConnectComponent, notImplemented, TransferInput } from "../types.ts";
import { StripeHttp } from "./http.ts";

export class StripeConnect {
  constructor(private http: StripeHttp) {}

  async transfer(i: TransferInput): Promise<{ id: string }> {
    const t = await this.http.post<{ id: string }>(
      "/transfers",
      {
        amount: i.amountCents,
        currency: "usd",
        destination: i.destination,
        metadata: { payout_id: i.payoutId },
      },
      i.idempotencyKey,
    );
    return { id: t.id };
  }

  createConnectedAccount(_i: {
    taskerId: string;
    email: string;
    idempotencyKey: string;
  }): Promise<{ accountId: string }> {
    return notImplemented("createConnectedAccount");
  }
  accountSession(
    _accountId: string,
    _components: ConnectComponent[],
  ): Promise<{ clientSecret: string }> {
    return notImplemented("accountSession");
  }
  accountLink(
    _accountId: string,
    _refreshUrl: string,
    _returnUrl: string,
  ): Promise<{ url: string }> {
    return notImplemented("accountLink");
  }
  retrieveAccount(_accountId: string): Promise<AccountStatus> {
    return notImplemented("retrieveAccount");
  }
  reverseTransfer(
    _transferId: string,
    _amountCents: number,
    _idempotencyKey: string,
  ): Promise<{ id: string }> {
    return notImplemented("reverseTransfer");
  }
}
