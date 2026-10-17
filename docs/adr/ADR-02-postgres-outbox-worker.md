# ADR-02: PostgreSQL Outbox + Same-Codebase Worker

- **Status:** ✅ ACCEPTED (validated in G01; was RECOMMENDED)
- **Date:** 2026-10-17
- **Related:** Decision Register ADR-02; 02-Architecture §2, §7; 04-Integrations-Contracts §"Dispatcher/Outbox Worker"

## Context

The integration core (ADR-04) needs durable, retryable, idempotent job
dispatch. The classic choice is "introduce Redis + a queue + a worker
service". That is premature for v1: it adds three moving parts and a second
source of truth before any integration is even live.

## Decision

**Use the PostgreSQL outbox pattern. The worker runs as a second process of
the same image and codebase.**

- Domain transactions write to domain tables AND an `OutboxEvent` row in the
  same DB transaction. This guarantees "if the state changed, an event was
  published".
- A worker process polls `OutboxEvent` (rows where `dispatchedAt IS NULL`),
  dispatches them, and marks them dispatched. Retries are idempotent.
- The worker uses the same Docker image as the web app (`Dockerfile` prod
  target); `docker-compose.yml` runs it as a separate service with
  `STR_WORKER=true`.
- No Redis, no Kafka, no separate worker codebase. One repo, one version.

## Alternatives considered

1. **Redis + BullMQ.** Rejected for v1 — adds an operational dependency and a
   second failure domain. Revisit when throughput actually requires it.
2. **Separate worker codebase.** Rejected — duplicates types and schema
   management. The modular monolith principle applies to the worker too.
3. **In-process dispatcher (no worker).** Rejected — a crashed web process
   would lose in-flight jobs. Durable means "survives a process restart".

## Consequences

- ✅ Zero additional infrastructure beyond PostgreSQL.
- ✅ Transactional consistency between state changes and event publication.
- ✅ Worker can be scaled independently by running more replicas.
- ⚠️ Polling has latency (~2s by default, configurable). Acceptable for v1
  integrations; can move to `LISTEN/NOTIFY` later if needed.
- ⚠️ The `OutboxEvent` table needs a retention/cleanup job — to be wired in G07.
- ⚠️ The worker healthcheck in G01 is a keepalive stub; real dispatch arrives
  in G07. This is documented honestly, not hidden.
