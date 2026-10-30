// Fake Connect and transfers (never moves money). Owned by WS5: `transfer` keeps today's behaviour; the
// new-contract methods (docs/contracts.md 4.4) are stubs until WS5 implements them.

import { AccountStatus, ConnectComponent, notImplemented, TransferInput } from "../types.ts";
import { checkAmount, fakeId } from "./scenarios.ts";

export class FakeConnect {
  async transfer(i: TransferInput): Promise<{ id: string }> {
    checkAmount(i.amountCents);
    return { id: await fakeId("tr", i.idempotencyKey) };
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
