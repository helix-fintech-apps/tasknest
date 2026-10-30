import type { Allocation, Quote } from "@domain";
import { call, newIdempotencyKey } from "./core";

export interface QuoteRequest {
  taskerId: string;
  minutes: number;
  promoCode?: string;
  pointsRequested?: number;
}
export interface QuoteResponse {
  quote: Quote;
  allocation: Allocation;
  discountCents?: number;
  policyVersion?: number;
}

export interface CreateBookingRequest {
  taskerId: string;
  localStart: string; // "YYYY-MM-DDTHH:mm" in tz
  tz: string;
  minutes: number;
  description: string;
  promoCode?: string;
  pointsRequested?: number;
}
export interface BookingResponse {
  booking: { id: string; status: string; [k: string]: unknown };
  [k: string]: unknown;
}

export const bookingApi = {
  quote: (b: QuoteRequest) => call<QuoteResponse>("POST", "/quote", b, newIdempotencyKey()),
  createBooking: (b: CreateBookingRequest, key: string) =>
    call<BookingResponse>("POST", "/bookings", b, key),
};
