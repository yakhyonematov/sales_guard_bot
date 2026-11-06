# OKK Telegram Bot — Sales Department Penalty Tracking System

A production-ready Telegram Bot built with **NestJS**, **TypeScript (strict mode)**, **Telegraf**, and **Prisma ORM (PostgreSQL)** for recording, calculating, and monitoring quality control penalties ("shtraf") for sales managers based on progressive escalation scales.

All user-facing bot messages and interactions are in **Uzbek (Latin script)**. Code, comments, identifiers, and documentation are in **English**.

---

## 1. Tech Stack

- **Runtime & Language:** Node.js 20+, TypeScript 5 (Strict Mode)
- **Framework:** NestJS 11 (Modular Architecture)
- **Telegram:** `nestjs-telegraf` + `telegraf` (Wizards, Scenes, Custom Session Middleware, Inline Keyboards, Callback Queries)
- **Database & ORM:** PostgreSQL 16 + Prisma ORM (Client, Migrations, Seed script)
- **Session Storage:** Persistent PostgreSQL-backed session middleware (`Session` model) that survives process restarts
- **Reports & Export:** `exceljs` for multi-sheet `.xlsx` reports (Summary, By manager, By clause, Violations log)
- **Timezone:** All calendar calculations, month boundaries, and timestamps operate strictly in `Asia/Tashkent` (UTC+5)
- **Containerization:** Docker multi-stage build & `docker-compose.yml`

---

## 2. Business Domain & Progressive Scales

Inspectors ("Xodim" / Staff) check sales managers' compliance against defined clauses. When a violation is recorded, the bot automatically determines the **occurrence index** for that manager and clause within the **current calendar month in Asia/Tashkent**, and applies the corresponding penalty:

### Progressive Scales (Pre-seeded)

- **Occurrence tiers:**
  - `1`: 1-marta (Bazaviy)
  - `2`: 2-marta (Takroriy)
  - `3`: 3-marta (Tizimli)
  - `4`: 4-marta (Kritik)
  - `5+`: 5+ marta (Kritik) — applies to the 5th and every subsequent violation of that clause within the calendar month.

- **Scale A (Clauses 2.1, 2.7, 2.13, 2.22):**
  - 1: `AMOUNT 60000` (60 000 so'm)
  - 2: `AMOUNT 60000` (60 000 so'm)
  - 3: `AMOUNT 100000` (100 000 so'm)
  - 4: `AMOUNT 0` (0 so'm)
  - 5+: `FACT` (Fakt olindi)

- **Scale B (Clauses 3.1, 3.3, 3.5, 3.10, 3.11):**
  - 1: `AMOUNT 100000` (100 000 so'm)
  - 2: `AMOUNT 100000` (100 000 so'm)
  - 3: `AMOUNT 0` (0 so'm)
  - 4: `FACT` (Fakt olindi)
  - 5+: `FACT` (Fakt olindi)

- **Scale C (Clause 4.2):**
  - 1: `AMOUNT 0` (0 so'm)
  - 2: `AMOUNT 0` (0 so'm)
  - 3: `FACT` (Fakt olindi)
  - 4: `FACT` (Fakt olindi)
  - 5+: `FACT` (Fakt olindi)

### Pre-seeded Clause Texts
- **2.1**: Ustiy dogovorda kerakli punktlarni qoldirib ketish mumkin emas.
- **2.7**: O'quvchining o'qishi bo'yicha analiz qilish kerak.
- **2.13**: Crmdan tashqari saqlangan zapislarni 12 soat ichida zapis gruppaga jo'natish kerak.
- **2.22**: To'lov bo'yicha ota-ona savoliga to'g'ri va to'liq javob berish kerak.
- **3.1**: 1 oylik kurs narxini aytish shart. Kurs paketlarini yashirish mumkin emas.
- **3.3**: Vozvratga bog'liq vozvrajeniyani menejer to'liq yopishi kerak.
- **3.5**: Ustiy dogovor yo'q.
- **3.10**: Konsultatsiya bermasdan sotish mumkin emas.
- **3.11**: 'Free Tasks'siz 6 va 12 oylik kurslarni sotish mumkin emas.
- **4.2**: Vozvrat bor deb aytish mumkin emas.

---

## 3. Roles and Permissions

1. **SUPER_ADMIN (Bosh admin):**
   - Auto-provisioned by `SUPER_ADMIN_TELEGRAM_IDS` in `.env`.
   - Full access to all staff and inspector actions.
   - CRUD Managers (add, edit, move between ROPs, deactivate).
   - CRUD Clauses and Scales (with option to recalculate current month or apply to future).
   - CRUD ROPs and Staff members.
   - Generate one-time invite codes (`INV-XXXX`) for Staff and ROPs.
   - Global statistics and Excel reports export.
   - Audit log viewer and Broadcast messaging.

2. **STAFF (Xodim / Inspector):**
   - Record violations using step-by-step wizard.
   - Revoke violations they recorded with a reason (or any violation if configured).
   - View recent violations list with filters.
   - Add/manage managers and view team statistics.

3. **ROP (Team Lead):**
   - Instant notifications when their managers receive violations.
   - Automatic **Training Alert ("Obuchenie lozim")** when a manager reaches the configured threshold (default: 2nd occurrence in a month, or any FACT result).
   - Team performance statistics, manager rankings, and Excel exports.
   - Review and approve manager self-registration requests.

4. **MANAGER:**
   - Real-time notifications upon receiving a penalty.
   - Personal statistics with per-clause breakdown.
   - **Risk Warning View ("Xavf ostidagi bandlar")**: computes what consequence will occur if they violate a clause again.
   - Personal violation history.

---

## 4. Setup and Installation

### Prerequisites
- Node.js 20+ (tested on Node 22)
- Docker & Docker Compose OR PostgreSQL 15+

### 1. Environment Setup
Copy the example environment file and configure your credentials:
```bash
cp .env.example .env
```

Edit `.env`:
```env
BOT_TOKEN=123456789:ABCDefGhIJKlmNoPQRsTUVwxyZ
SUPER_ADMIN_TELEGRAM_IDS=12345678,87654321
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/okk_penalty_bot?schema=public"
TIMEZONE=Asia/Tashkent
DEFAULT_TRAINING_THRESHOLD=2
STAFF_CAN_REVOKE_OTHERS=false
USE_WEBHOOK=false
```

### 2. Database Migration and Seeding
```bash
# Push Prisma schema to PostgreSQL
npx prisma db push

# Seed scales, clauses, settings, super admin, and sample ROP/managers
npx prisma db seed
```

### 3. Running Locally
```bash
# Development mode with hot-reload
npm run start:dev

# Production build and run
npm run build
npm run start:prod
```

### 4. Running with Docker Compose
```bash
docker compose up -d --build
```

---

## 5. Testing

Unit tests for `PenaltyEngineService` (covering all scales, tiers, month boundaries, 5+ rule, and chain recomputations) and service-level integration tests:
```bash
# Run unit & service tests
npm test

# Run e2e tests
npm run test:e2e
```

---

## 6. Architectural Rationale & Edge Cases Handled

1. **Transaction Isolation & Concurrency Safety:**
   - Recording violations uses `prisma.$transaction` with `Serializable` isolation level to prevent race conditions when two inspectors record a penalty for the same manager simultaneously.

2. **Idempotency & Double-Tap Prevention:**
   - Every confirmation prompt generates a unique UUID `idempotencyKey`. The UI disables the confirmation button immediately, and the backend verifies the key prior to inserting.

3. **Dynamic Recomputation on Revoke/Restore:**
   - When a violation is revoked (soft-deleted with timestamp, actor, and reason) or restored, all subsequent active violations for that manager and clause within that calendar month are recalculated in a single atomic transaction. Affected managers and ROPs receive notification updates.

4. **Asia/Tashkent Calendar Boundaries:**
   - Calendar month keys (`YYYY-MM`) and month ranges are derived using `luxon` in the `Asia/Tashkent` timezone, guaranteeing zero discrepancies across UTC month turnovers.

5. **Safe Telegram Notification Delivery:**
   - Notification dispatch handles Telegram API HTTP 403 ("bot blocked by user") and HTTP 429 rate limits gracefully without crashing the bot or failing the business transaction.

6. **Global Exception Handling:**
   - A dedicated `BotGlobalExceptionFilter` intercepts all unexpected exceptions inside Telegraf handlers, logs the stack trace, and sends a polite user-facing error message in Uzbek.
