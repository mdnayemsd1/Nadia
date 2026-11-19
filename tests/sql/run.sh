#!/usr/bin/env bash
# Runs the migrations + seed + behaviour tests on a scratch PostgreSQL database (Supabase pieces are stubbed).
# Usage: sudo tests/sql/run.sh   (needs a local PostgreSQL server)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL="psql -v ON_ERROR_STOP=1 -q"
run() { (cd "$ROOT" && su postgres -c "$PSQL -d ngh_test -f $1" 2>&1); }
su postgres -c "psql -q -c 'drop database if exists ngh_test' -c 'create database ngh_test'" 2>&1 | grep -v NOTICE || true
for f in tests/sql/supabase_stub.sql supabase/migrations/001_schema.sql supabase/migrations/002_rls_storage_realtime.sql supabase/seed_sample_data.sql; do run "$ROOT/$f" >/dev/null; done
(cd "$ROOT" && run "$ROOT/tests/sql/behaviour.test.sql") | grep -E "PASS|ERROR|ASSERT|FAIL|wrong error" || true
