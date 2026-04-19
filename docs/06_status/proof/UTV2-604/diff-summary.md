# UTV2-604 Diff Summary

Implemented fail-closed Supabase RLS posture:

- Added a dedicated security migration enabling row-level security on every canonical public table.
- Revoked direct `anon` and `authenticated` table access when those Supabase roles exist.
- Left service-role runtime access unchanged; API/worker/operator paths continue through repository interfaces.
- Added a migration coverage test that checks every `canonicalTables` entry is represented and no permissive client policies are created.
