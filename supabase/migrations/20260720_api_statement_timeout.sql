-- Dashboard weekly block queries shift_daily_metrics for 7 days; default API timeout is too low.

ALTER ROLE authenticator SET statement_timeout TO '60s';
ALTER ROLE anon SET statement_timeout TO '60s';
ALTER ROLE authenticated SET statement_timeout TO '60s';
ALTER ROLE service_role SET statement_timeout TO '120s';
