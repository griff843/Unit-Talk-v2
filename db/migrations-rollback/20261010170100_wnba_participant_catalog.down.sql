-- UTV2-1972 rollback: remove only participant rows created and tagged by the
-- governed WNBA seed. Shared WNBA sport, league, and market-availability rows
-- are intentionally retained because they can predate and outlive this catalog.
BEGIN;

SELECT p.id
FROM public.participants AS p
WHERE p.id = ANY (ARRAY[
  'c0fa5bc8-30d0-56a6-b265-1baa5778cd1f'::uuid,
  '59f76962-c222-5e9c-bc30-67e7bbaaf524'::uuid,
  '08e883a0-2f78-56c0-8ba0-6ddccdb1a615'::uuid,
  'e548c6b6-44ad-5dae-8977-5ea0e23e7691'::uuid,
  '194e5e5b-3b5f-5c11-82da-3afc662e8972'::uuid,
  'ed9242cd-8188-5b7d-b187-4d9658dcade0'::uuid,
  '99f4f632-a531-5d35-8410-ed30b0d82733'::uuid,
  '73ac7b96-d082-5ab6-8b0a-7c792331a6be'::uuid,
  '2235e78d-43fb-56ec-b68d-fc6e7ed910dd'::uuid,
  '193e2297-4de0-5523-81dd-540acfa5ccc6'::uuid,
  'c075c102-a873-5b6f-b2f3-dae2b70bc207'::uuid,
  '1408d5a9-593f-5ab5-b606-5d527dbe6cfd'::uuid,
  '364693b2-aa0d-587c-9024-1a6b7e6e0b5a'::uuid,
  '0206969a-f1f9-5122-aadd-2af77c3e3b5e'::uuid,
  '9785af36-9db6-507d-85c0-5f25907c949c'::uuid
]::uuid[])
  AND p.metadata->>'seedIssue' = 'UTV2-1972'
ORDER BY p.id
FOR UPDATE;

DO $rollback$
DECLARE
  governed_ids uuid[] := ARRAY[
    'c0fa5bc8-30d0-56a6-b265-1baa5778cd1f'::uuid,
    '59f76962-c222-5e9c-bc30-67e7bbaaf524'::uuid,
    '08e883a0-2f78-56c0-8ba0-6ddccdb1a615'::uuid,
    'e548c6b6-44ad-5dae-8977-5ea0e23e7691'::uuid,
    '194e5e5b-3b5f-5c11-82da-3afc662e8972'::uuid,
    'ed9242cd-8188-5b7d-b187-4d9658dcade0'::uuid,
    '99f4f632-a531-5d35-8410-ed30b0d82733'::uuid,
    '73ac7b96-d082-5ab6-8b0a-7c792331a6be'::uuid,
    '2235e78d-43fb-56ec-b68d-fc6e7ed910dd'::uuid,
    '193e2297-4de0-5523-81dd-540acfa5ccc6'::uuid,
    'c075c102-a873-5b6f-b2f3-dae2b70bc207'::uuid,
    '1408d5a9-593f-5ab5-b606-5d527dbe6cfd'::uuid,
    '364693b2-aa0d-587c-9024-1a6b7e6e0b5a'::uuid,
    '0206969a-f1f9-5122-aadd-2af77c3e3b5e'::uuid,
    '9785af36-9db6-507d-85c0-5f25907c949c'::uuid
  ];
  reference record;
  is_referenced boolean;
BEGIN
  -- Refuse before DELETE even for cascading relationships. The row lock above
  -- also prevents a concurrent FK insert from slipping between scan and delete.
  FOR reference IN
    SELECT
      constraint_row.conrelid::regclass AS relation_name,
      source_attribute.attname AS column_name
    FROM pg_constraint AS constraint_row
    CROSS JOIN LATERAL unnest(
      constraint_row.conkey,
      constraint_row.confkey
    ) AS key_pair(source_number, target_number)
    JOIN pg_attribute AS source_attribute
      ON source_attribute.attrelid = constraint_row.conrelid
     AND source_attribute.attnum = key_pair.source_number
    JOIN pg_attribute AS target_attribute
      ON target_attribute.attrelid = constraint_row.confrelid
     AND target_attribute.attnum = key_pair.target_number
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'public.participants'::regclass
      AND target_attribute.attname = 'id'
  LOOP
    EXECUTE format(
      'SELECT EXISTS (
         SELECT 1
         FROM %s
         WHERE %I = ANY ($1)
           AND %I IN (
             SELECT p.id
             FROM public.participants AS p
             WHERE p.metadata->>''seedIssue'' = ''UTV2-1972''
           )
       )',
      reference.relation_name,
      reference.column_name,
      reference.column_name
    ) INTO is_referenced USING governed_ids;

    IF is_referenced THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0001',
        MESSAGE = 'UTV2-1972 rollback refused: seeded participant is referenced';
    END IF;
  END LOOP;
END
$rollback$;

DELETE FROM public.participants AS p
WHERE p.id = ANY (ARRAY[
  'c0fa5bc8-30d0-56a6-b265-1baa5778cd1f'::uuid,
  '59f76962-c222-5e9c-bc30-67e7bbaaf524'::uuid,
  '08e883a0-2f78-56c0-8ba0-6ddccdb1a615'::uuid,
  'e548c6b6-44ad-5dae-8977-5ea0e23e7691'::uuid,
  '194e5e5b-3b5f-5c11-82da-3afc662e8972'::uuid,
  'ed9242cd-8188-5b7d-b187-4d9658dcade0'::uuid,
  '99f4f632-a531-5d35-8410-ed30b0d82733'::uuid,
  '73ac7b96-d082-5ab6-8b0a-7c792331a6be'::uuid,
  '2235e78d-43fb-56ec-b68d-fc6e7ed910dd'::uuid,
  '193e2297-4de0-5523-81dd-540acfa5ccc6'::uuid,
  'c075c102-a873-5b6f-b2f3-dae2b70bc207'::uuid,
  '1408d5a9-593f-5ab5-b606-5d527dbe6cfd'::uuid,
  '364693b2-aa0d-587c-9024-1a6b7e6e0b5a'::uuid,
  '0206969a-f1f9-5122-aadd-2af77c3e3b5e'::uuid,
  '9785af36-9db6-507d-85c0-5f25907c949c'::uuid
]::uuid[])
  AND p.metadata->>'seedIssue' = 'UTV2-1972';

COMMIT;
