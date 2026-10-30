-- Marketplace contract, part 1 of 2: new booking_status values (docs/contracts.md 4.1, 4.2).
--
-- Postgres cannot use a new enum value in the transaction that added it, and the next migration
-- (20261101000000_marketplace_contract.sql) uses 'pending_payment' in an index predicate. So the values are
-- added here, in a migration of their own, and committed before anything references them.
-- Nothing writes these values yet: the state machine change ships with WS7's domain work.

alter type public.booking_status add value if not exists 'pending_payment';
alter type public.booking_status add value if not exists 'payment_abandoned';
