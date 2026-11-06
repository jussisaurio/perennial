-- Better Auth keeps its rate-limit counters in memory now (#603), not in a row
-- read and written on every auth request.
drop table "rateLimit";
