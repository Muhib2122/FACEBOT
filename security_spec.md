# FaceBot ESP32 AI Portal — Firestore Security Specification (Phase 0 TDD)

## 1. Data Invariants
1. **Verified Single-Owner Isolation**: Every document under `/users/{userId}` and its subcollections (`alarms`, `reactions`, `interactions`, `playlist`) is strictly readable and writable ONLY by the authenticated user whose `request.auth.uid == userId` AND `request.auth.token.email_verified == true`.
2. **Master Gate Parent Existence**: Subcollection documents (`alarms`, `reactions`, `interactions`, `playlist`) cannot be created, updated, fetched, or deleted unless the parent workspace document `/users/{userId}` exists (`exists(...)`), preventing orphaned sub-records.
3. **Zero Unverified Writes & Zero Shadow Fields**: Every `create` enforces exact required + allowed keys via `hasAll` and `hasOnly`. Every `update` enforces `isValid[Entity](incoming())` first AND explicit action-scoped `affectedKeys().hasOnly(...)` allowlists.
4. **Immutability & Server Temporal Integrity**: `ownerId` and `createdAt` are strictly immutable after creation. `createdAt == request.time` on create; `updatedAt == request.time` on update. Interaction events are append-only (`update: if false`).
5. **Path ID & Payload Bounds (Denial-of-Wallet Guard)**: All single-document path IDs must match `^[a-zA-Z0-9_\-]+$` (<= 128 chars). Every string and array enforces explicit `.size()` bounds (`pixelsHex` == 2048 chars, `days` <= 7 items).
6. **Zero-Delegation List Queries**: Every `allow list` verifies `isVerifiedOwner(userId) && resource.data.ownerId == request.auth.uid` without any `get()`/`exists()` calls.

## 2. The "Dirty Dozen" Adversarial Payloads (Must All Return PERMISSION_DENIED)
1. **Cross-Tenant Read**: User B attempts `get` on `/users/{userA}` or `/users/{userA}/alarms/al-1`.
2. **Unverified Email Write**: User A with `email_verified: false` attempts to create `/users/{userA}`.
3. **Owner Spoofing**: User A creates `/users/{userA}/alarms/al-1` with `ownerId: "userB"`.
4. **Shadow Ghost Field Injection**: User A updates `/users/{userA}` adding `{ isAdmin: true }`.
5. **Oversized Path ID Poisoning**: User A writes to `/users/{userA}/alarms/${'a'.repeat(200)}`.
6. **Client-Forged Timestamp**: User A creates `/users/{userA}/interactions/ev-1` with a client epoch timestamp instead of `serverTimestamp()`.
7. **Immutable Field Mutation**: User A updates `/users/{userA}/alarms/al-1` attempting to modify `createdAt` or `ownerId`.
8. **Orphaned Subcollection Write**: User A creates `/users/{userA}/alarms/al-1` before parent `/users/{userA}` exists.
9. **Value Poisoning on Allowed Key**: User A updates `userName` with a 500-character string or a boolean.
10. **Array Overflow Attack**: User A creates an alarm with `days: [0,1,2,3,4,5,6,7,8]` (size > 7) or non-int elements.
11. **Immutable Log Tampering**: User A attempts to `update` an existing `/users/{userA}/interactions/ev-1` audit entry.
12. **Bitmap Size Exhaustion**: User A creates `/users/{userA}/reactions/r-1` with a 100KB `pixelsHex` string instead of exact 2048 chars.
