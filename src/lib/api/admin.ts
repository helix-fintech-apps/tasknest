import { call, enc, type GenericResponse } from "./core";

export const adminApi = {
  runPayouts: (key: string) => call<GenericResponse>("POST", "/payouts/run", {}, key),
  setTaskerStatus: (
    taskerId: string,
    status: "active" | "suspended",
    reason: string,
    key: string,
  ) =>
    call<GenericResponse>(
      "POST",
      `/admin/taskers/${enc(taskerId)}/status`,
      { status, reason },
      key,
    ),
  simulateDispute: (bookingId: string, outcome: "won" | "lost", key: string) =>
    call<GenericResponse>("POST", "/admin/disputes/simulate", { bookingId, outcome }, key),
};
