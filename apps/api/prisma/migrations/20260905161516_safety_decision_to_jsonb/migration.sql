-- `ai_invocations.safety_decision` becomes jsonb (issue #82, epic E06).
--
-- Prisma's own diff would DROP and re-ADD the column. Rewritten as an in-place
-- conversion instead: nothing has written this column since #21 created it, so
-- the two are equivalent today — but a migration that silently discards a
-- column's contents is not a thing to leave in the history for someone to copy.
-- `to_jsonb` turns any legacy 'allow' / 'conservative' / 'redirect' text into a
-- valid JSON string rather than failing on it.
ALTER TABLE "ai_invocations"
  ALTER COLUMN "safety_decision" TYPE JSONB
  USING (
    CASE
      WHEN "safety_decision" IS NULL THEN NULL
      ELSE to_jsonb("safety_decision")
    END
  );
