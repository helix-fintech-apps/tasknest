import { call, enc } from "./core";
import type { BookingResponse } from "./booking";

export interface CompleteRequest {
  extraMinutes?: number;
  expensesCents?: number;
}

export const taskerApi = {
  accept: (id: string, key: string) =>
    call<BookingResponse>("POST", `/bookings/${enc(id)}/accept`, {}, key),
  decline: (id: string, key: string) =>
    call<BookingResponse>("POST", `/bookings/${enc(id)}/decline`, {}, key),
  start: (id: string, key: string) =>
    call<BookingResponse>("POST", `/bookings/${enc(id)}/start`, {}, key),
  complete: (id: string, b: CompleteRequest, key: string) =>
    call<BookingResponse>("POST", `/bookings/${enc(id)}/complete`, b, key),
};
