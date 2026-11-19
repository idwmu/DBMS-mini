# Student Workload & Deadline Collision Analyzer — Next.js + PostgreSQL

A full-stack DBMS course project that detects student academic overload, finds deadline clustering across concurrent courses, and gives faculty a "what-if" deadline simulator.

This is the **Next.js + PostgreSQL** version of the original MySQL + Express + Vite/React + Redis app. Features, endpoints, scoring math and the UI are the same. The database logic still lives in the database, as PL/pgSQL functions, views and triggers.

---

## Architecture

```mermaid
graph TD
    subgraph Next["Next.js 16 app (port 3000)"]
        Pages["App Router pages (React 19 + Recharts)"]
        Proxy["proxy.js — server-side route guard (JWT cookie)"]
        API["Route handlers /api/* — zod validation, RBAC"]
        Services["Service layer: authService / studentService / facultyService"]
    end

    subgraph PG["PostgreSQL: student_workload"]
        Tables[(10 normalized tables)]
        Functions["PL/pgSQL: sp_calculate_workload, sp_detect_collisions,<br/>sp_assign_task_to_students, sp_simulate_deadline_change, sp_refresh_student"]
        Views["Views: v_student_task_overview, v_course_risk_summary,<br/>v_high_risk_students, v_latest_workload"]
        Triggers["Triggers: circular dependencies (recursive CTE),<br/>deadline > release, auto-analysis on assignment"]
    end

    Pages -->|fetch, httpOnly cookie| API
    Proxy --> Pages
    API --> Services -->|node-postgres pool| Tables
    Services -->|SELECT sp_*()| Functions
    Services --> Views
    Tables --> Triggers
```

| Layer | Technology |
|---|---|
| Database | PostgreSQL 14+ (tested on 16): tables, views, PL/pgSQL functions, triggers |
| Backend | Next.js route handlers, `pg` connection pool, `zod`, `bcryptjs`, `jose` (JWT) |
| Frontend | Next.js App Router, React 19, Recharts, the original Apple-style CSS design system (light/dark) |
| Tests | `node:test` API integration suite (41 tests) |

---

## Quick start

**Prerequisites:** Node.js 20+ and a PostgreSQL server. If you don't have Postgres, run `docker compose up -d`.

```bash
# 1. Install
npm install

# 2. Configure: edit DATABASE_URL if your Postgres user/password differ
cp .env.example .env.local

# 3. Create the database, schema, functions, triggers and demo data
npm run db:setup

# 4. Run
npm run dev            # http://localhost:3000
```

Production: `npm run build && npm start`.

`npm run db:setup` is re-runnable. It drops and recreates every table, then runs, in order:

1. `db/schema/001_schema.sql` — 10 tables with foreign keys, CHECK constraints and indexes
2. `db/logic/001_views.sql` — views
3. `db/logic/002_functions.sql` — the workload and collision engine
4. `db/logic/003_triggers.sql` — integrity and sync triggers
5. `db/seed/seed.sql` — 2 faculty, 8 students, 4 courses, 12 tasks. Dates are relative to `NOW()`, so the demo data never goes stale.

Use `npm run db:setup -- --no-seed` to set up without demo data.

### Tests

With the app running (`npm run dev` or `npm start`), in another terminal:

```bash
npm test                      # BASE_URL defaults to http://localhost:3000
```

The tests change data, so run `npm run db:setup` again afterwards for a clean demo.

---

## Demo accounts (password for all: `password123`)

The login page has one-click demo buttons.

| Role | Email | Showcases |
|---|---|---|
| Faculty | `sarah@university.edu` | CS401 (DBMS) and CS601 (Cloud); simulator and cohort risk |
| Faculty | `raj@university.edu` | CS402 (OS) and CS602 (ML) |
| Student | `alice@university.edu` | CRITICAL risk with deadline cluster, overload and assessment overlap |
| Student | `bob@university.edu` | 15h availability causing severe OVERLOAD |
| Student | `charlie@university.edu` | Moderate progress |
| Student | `diana@university.edu` | Balanced workload, ample study blocks |

The seed also contains an `admin@university.edu` admin account. Admins use the faculty area.

---

## Workload engine (unchanged from the original)

**Five pressures (0–100) and their weights:**

| Pressure | Weight | Formula |
|---|---|---|
| Temporal | 25% | `min(100, tasks_due / window_days × 7 × 20)`. Five deadlines a week scores 100. |
| Workload | 30% | `min(100, remaining_hours / available_hours × 100)`. Remaining hours = estimate × (1 − completion). |
| Cognitive | 15% | `avg(difficulty[1-5] × cognitive_load[1-10]) / 50 × 100` |
| Assessment | 20% | Sum of grade weights due in the window |
| Dependency | 10% | 25 points per unfinished prerequisite |

`Overall = 0.25·T + 0.30·W + 0.15·C + 0.20·A + 0.10·D`

Risk levels: **LOW** < 30 ≤ **MEDIUM** < 55 ≤ **HIGH** < 75 ≤ **CRITICAL**.

If a student hasn't logged any availability, the engine assumes 4 study hours per day.

The PL/pgSQL keeps MySQL's intermediate DECIMAL rounding (`scale + 4`), so scores match the original exactly. For example, Alice scores 79.55 (CRITICAL) in both versions.

**Collision rules (`sp_detect_collisions`):**

- **DEADLINE_CLUSTER:** 3 or more pending deadlines within 48 hours. Severity is HIGH at 4 or more.
- **OVERLOAD:** required hours exceed available hours. Severity is HIGH at 1.5× or more.
- **ASSESSMENT_OVERLAP:** 2 or more deliverables within 24 hours with a combined weight of 25% or more.

**Simulator (`sp_simulate_deadline_change`):** compares how many other same-semester tasks fall within ±48 hours of the original deadline versus the proposed one. Each extra clash adds 15 risk points. The result is **APPROVE**, **SUGGEST ALTERNATE DATE** or **NOT RECOMMENDED**, and every run is logged in `simulations`. The task itself is never modified.

---

## Database objects

| Object | Kind | Purpose |
|---|---|---|
| `sp_calculate_workload(student, start, end)` | function → `workload_analysis` row | Five pressures and the risk score. Persists a snapshot. |
| `sp_detect_collisions(student)` | function → int | Inserts new, non-duplicate collisions |
| `sp_assign_task_to_students(task)` | function → int | Assigns a task to its semester cohort (`ON CONFLICT DO NOTHING`) |
| `sp_simulate_deadline_change(task, deadline, faculty)` | function → `simulations` row | What-if analysis |
| `sp_refresh_student(student)` | function | Recalculates and detects; called after every change that affects a student |
| `trg_prevent_circular_dependencies` | BEFORE INSERT/UPDATE trigger | Recursive CTE that rejects A → B → … → A |
| `trg_tasks_deadline_check` | BEFORE INSERT/UPDATE trigger | Requires `deadline > release` |
| `trg_student_tasks_after_insert` | AFTER INSERT trigger | Analyzes the student when a task is assigned. Skip it with `SET app.disable_triggers = '1'`. |
| `v_latest_workload` | view (`DISTINCT ON`) | Latest analysis per student |
| `v_student_task_overview` | view | Flat task view with `is_overdue` and `hours_until_deadline` |
| `v_course_risk_summary` | view | Per-course enrollment, completion and average risk |
| `v_high_risk_students` | view | Students at HIGH or CRITICAL risk |

Trigger and function errors (`RAISE EXCEPTION`, SQLSTATE `P0001`) come back from the API as HTTP 400, with the database's message.

---

## API

The base URL is `/api`. Endpoints, payloads and the response envelope (`{ success, data, message }`) are the same as the original, so the Express API reference still applies:

- **Auth:** `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` (new)
- **Student:** `/student/profile`, `/student/availability[/:id]`, `/student/tasks`, `/student/tasks/:id/progress`, `/student/tasks/:id/submit`, `/student/workload` (alias `/workload/current`), `/student/workload/calculate`, `/student/collisions`, `/student/collisions/:id/resolve`, `/student/deadlines/priority?withinDays=&limit=`
- **Faculty:** `/faculty/courses[/:id]`, `/faculty/courses/:id/risk-summary`, `/faculty/tasks[/:id]` (supports `?course_id=`), `/faculty/tasks/:id/dependencies[/:prereqId]`, `/faculty/tasks/:id/students`, `/faculty/simulations` (aliases `/simulator/run`, `/simulator/history`)
- **Health:** `GET /health` reports database connectivity

Login sets an **httpOnly cookie**, which is what the browser uses. The token is also returned in the response body, so API clients can keep using `Authorization: Bearer <token>`.

---

## What changed from the MySQL / Express / Redis version

**Stack**

| Before | After |
|---|---|
| MySQL stored procedures (`CALL sp_…`) | PL/pgSQL functions (`SELECT sp_…()`) with the same names. They return the row they write. |
| `SIGNAL SQLSTATE '45000'` | `RAISE EXCEPTION` (P0001) |
| Cursor loop in `sp_detect_collisions` | `FOR rec IN SELECT … LOOP` |
| Two deadline triggers (insert and update) | One `BEFORE INSERT OR UPDATE` trigger |
| `DATETIME` (no time zone) | `TIMESTAMPTZ`. The API returns ISO 8601 and the UI sends ISO, so times are correct in any time zone. |
| Express + Vite (two servers) | One Next.js app (route handlers and pages) |
| JWT in `localStorage` | httpOnly cookie, with Bearer still supported, plus a server-side route guard (`src/proxy.js`) |
| express-validator | zod |
| **Redis** priority queue (ZSET) | Indexed Postgres query (`idx_tasks_deadline`) |
| **Redis** workload cache (5-minute TTL) | A recent 14-day analysis is reused for 5 minutes (`WORKLOAD_REUSE_SECONDS`). Every change already writes a fresh analysis row. |
| Jest + Supertest | `node:test` + fetch (41 tests) |

**Bugs fixed while porting**

- When a student submitted a task, the UI always overwrote their logged hours with 5. Logged hours are now kept.
- Date inputs used `toISOString()`, which shifted defaults by the UTC offset (5h30m in IST). They now use local time.
- The faculty dashboard's recent-simulations table read fields that don't exist (`predicted_risk_change`, `simulated_at`), so it showed `NaN` and "Invalid Date".
- "Simulate Deadline Shift" on a task now preselects that task in the simulator.
- The course chart's "Avg Completion" was always 0 because the API never returned it.
- Some pages used CSS variables that didn't exist, and hardcoded light backgrounds that broke dark mode.
- The OVERLOAD and ASSESSMENT_OVERLAP rule descriptions in the UI didn't match the actual logic.
- Faculty edits to tasks or dependencies now recalculate the affected students' risk, instead of only clearing a cache.
- Public registration can no longer create **admin** accounts.

---

## Project layout

```
db/                 schema, views, functions, triggers, seed (plain .sql)
scripts/db-setup.mjs
src/proxy.js        route guard
src/app/            pages + /api route handlers
src/components/     charts, badges, navbar, footer
src/context/        auth + theme providers
src/lib/            db pool, auth/JWT, http helpers, services
tests/api.test.mjs
```

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | — | Required |
| `JWT_SECRET` | dev fallback | **Required in production** |
| `JWT_EXPIRES_IN` | `7d` | |
| `DB_TIMEZONE` | server local zone | Used for dates in collision descriptions. Legacy names such as `Asia/Calcutta` are mapped automatically. |
| `WORKLOAD_REUSE_SECONDS` | `300` | |
| `DB_POOL_MAX` | `10` | |
