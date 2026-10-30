-- Scheduled jobs (plan 5 WS7 item 8). The API exposes POST /jobs/:name for the service key only. In production
-- pg_cron calls it through pg_net; locally and in fake mode the jobs run from the Test tools console instead.
--
--   private.call_job(name)   POSTs to <tasknest_functions_url>/api/jobs/<name> with the service key. Both values
--                            come from Supabase Vault (owner step, docs/DEPLOY.md): until they exist this does
--                            nothing, so replaying the migrations anywhere is safe.
--   cron.schedule(...)       only when pg_cron can be enabled; otherwise a notice.
--
-- Dynamic SQL keeps this file valid on databases without pg_net/Vault (plain Postgres, CI replays).

create or replace function private.call_job(p_name text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_url text;
begin
  if p_name !~ '^[a-z][a-z0-9_-]{0,63}$' then
    raise exception 'invalid: bad job name %', p_name;
  end if;
  begin
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'tasknest_service_key'$q$ into v_key;
    execute $q$select decrypted_secret from vault.decrypted_secrets where name = 'tasknest_functions_url'$q$ into v_url;
  exception when others then
    return; -- no Vault here
  end;
  if v_key is null or v_url is null then return; end if;
  execute $q$select net.http_post(url := $1, headers := $2, body := '{}'::jsonb)$q$
    using rtrim(v_url, '/') || '/api/jobs/' || p_name,
          jsonb_build_object('Authorization', 'Bearer ' || v_key, 'Content-Type', 'application/json');
end $$;

revoke execute on function private.call_job(text) from public, anon, authenticated;

do $$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron is not available (%); schedule the jobs from your own scheduler', sqlerrm;
    return;
  end;
  perform cron.schedule('tasknest-auto-decline-requests', '*/10 * * * *',
                        $c$select private.call_job('auto-decline-requests')$c$);
exception when others then
  raise notice 'could not schedule jobs (%); schedule them from your own scheduler', sqlerrm;
end $$;
