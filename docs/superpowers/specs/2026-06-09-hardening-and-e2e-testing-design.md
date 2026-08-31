# Spec: EyeGo V2 Hardening and E2E Testing Design

**Date:** 2026-06-09
**Status:** Draft / Proposed

---

## 1. Overview & Context

This document outlines the hardening state of the EyeGo V2 monorepo (comprising `eyego-api`, mobile apps, and shared packages) and establishes a comprehensive Jest-based testing strategy to prevent regressions.

---

## 2. Hardening Analysis & Core logic

Our scan of the monorepo confirmed that several P0 race conditions, TOCTOU bugs, and security/payment edge cases have been successfully mitigated:

*   **Seat Booking Races:** Mitigated via `Serializable` isolation level in Prisma `$transaction` inside `bookings.service.js`.
*   **Wallet Balance TOCTOU:** Protected by placing the balance check inside an atomic database transaction.
*   **Webhook Replays:** Protected using a Redis-backed NX lock to prevent concurrent webhook execution.
*   **Immediate seat release:** Added client-side best-effort trigger to cancel unpaid bookings on terminal payment failure.

---

## 3. Testing Architecture

To verify the backend and ensure end-to-end booking works seamlessly without edge cases, we developed a mock-based unit and integration test suite:

1.  **`auth.service.test.js`**: Verifies OTP lifecycle (request, verification, user creation, block of banned users, Firebase Google auth verify).
2.  **`wallet.service.test.js`**: Verifies atomic wallet top-up, withdrawal validation, and withdrawal failures triggers (ensuring compensating rollback transaction behaves correctly).
3.  **`payments.service.test.js`**: Tests synchronous payment paths (CASH/WALLET) and asynchronous payment initialization (CARD/MOMO), plus webhook verification.
4.  **`bookings.e2e.test.js`**: End-to-end simulation of rider booking a seat, executing wallet payment, and validating cancellations.
5.  **Regression Suites (`drivers.cancelTrip.test.js` & `bookings.cancelBooking.test.js`)**: Focus on driver cancellation realtime socket emit and seat hold release idempotency.

---

## 4. Suggested Gaps / Deploy Gates

*   **Postgres Migration:** Transition to PostgreSQL before production to support durable row-level locks and geosearch indexing.
*   **Durable Job Queues:** Implement BullMQ to replace memory-based `setInterval` sweeps for expired seat holds and trip timeouts.
*   **Secrets Audit:** Ensure `.env` and `firebase-service-account.json` are excluded from version control before final release.
