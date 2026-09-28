# Supabase setup

Apply migrations with the Supabase CLI from the repository root:

```bash
supabase db push
```

The initial migration creates the core tables and RLS policies. Do not commit service-role keys. Seed admin and learner accounts through Supabase Auth after applying the migration.
