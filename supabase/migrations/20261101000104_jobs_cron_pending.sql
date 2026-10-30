-- Schedule expire-pending-payments (plan 5 WS7 item 8) every 5 minutes. Same safety as 20261101000103: a
-- notice, not an error, where pg_cron is missing.
do $$
begin
  perform cron.schedule('tasknest-expire-pending-payments', '*/5 * * * *',
                        $c$select private.call_job('expire-pending-payments')$c$);
exception when others then
  raise notice 'could not schedule expire-pending-payments (%); schedule it from your own scheduler', sqlerrm;
end $$;
