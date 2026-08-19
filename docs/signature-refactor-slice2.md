# Signature refactor — Slice 2 (nda_requests)

Slice 1 introduced `SignaturePort` / `SignatureWebhookAdapter` + YouSign adapter + factory (`SIGNATURE_PROVIDER=yousign`). Call sites for provision, sign surface, PDF download, and webhook verify now go through the factory.

## What Slice 2 must do

### 1. Introduce `nda_requests` persistence layer

- Add Prisma model `NdaRequest` (or equivalent) to decouple enrollment rows from provider-specific IDs.
- Columns to migrate conceptually (keep existing `yousign_*` columns during transition — no rename in Slice 2 unless explicitly planned):
  - `yousignRequestId` → `nda_requests.providerRequestId`
  - `yousignSignerId` → `nda_requests.providerSignerId`
  - `yousignStatus`, `yousignSignerStatus`, mirror timestamps
- Dual-write or backfill strategy: read from `nda_requests` first, fall back to enrollment columns until backfill complete.

### 2. Remove `getSignatureAdapter()` escape hatch

Slice 1 leaves these on `YouSignAdapter` (via `getSignatureAdapter()`):

- `getSignatureRequest` — used by `syncYousignStatus` in `yousign-events.ts`
- `getSigner` — used by `syncYousignStatus`
- `reactivateNda` — used by `resend-nda` Inngest function

Slice 2 options (pick one minimal path):

- Extend `SignaturePort` with `syncRequestStatus` / `reactivateRequest` **or**
- Move sync/resend orchestration into a dedicated `NdaRequestService` that uses the port + `nda_requests` table.

### 3. Refactor services still coupled to YouSign columns

| File | Current coupling |
|------|------------------|
| `yousign-events.ts` | enrollment `yousignRequestId`, status mappers, `getSignatureAdapter()` |
| `enrollment.ts` | `persistNda*`, `clearNdaFields`, `resolveNdaSignUrl` |
| `create-nda-after-payment.ts` | persists `yousignRequestId` / `yousignSignerId` on enrollment |
| `resend-nda.ts` | `reactivateNda` + enrollment mirror |
| `nda-sync.ts` | admin sync via `syncYousignStatus` |
| Admin UI | `yousignAppUrl`, column labels |

### 4. Webhook processing

- Optionally route `signature_request.done` through `SignatureWebhookAdapter.mapCompletedEvent` in `handleYousignProviderEvent` (Slice 1 implements mapping; webhook route only uses `verify`).
- Resolve enrollment via `nda_requests.providerRequestId` instead of `enrollment.yousignRequestId`.

### 5. Out of scope for Slice 2 (later slices)

- DocuSeal adapter
- Renaming `yousign_*` DB columns or Inngest event names (`yousign/signature.done`)
- `contractStatus` transition rules (pending → sent → signed)
- DocusealPreview.astro wiring

## Acceptance criteria (Slice 2)

- NDA lifecycle reads/writes go through `nda_requests` as source of truth.
- No production code calls `getSignatureAdapter()` — only `getSignaturePort()` / `getSignatureWebhookAdapter()`.
- Enrollment row remains compatible (dual-read or migrated data).
- Existing admin + learner flows unchanged from user perspective.
