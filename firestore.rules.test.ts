// Phase 0 Security Rules Verification Suite (Dirty Dozen Test Specification)
// Verifies that all 12 adversarial payloads against FaceBot Firestore rules fail with PERMISSION_DENIED.

export interface DirtyDozenCase {
  id: number;
  name: string;
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  auth: { uid: string; email_verified: boolean } | null;
  payload?: Record<string, unknown>;
  expected: 'PERMISSION_DENIED';
}

export const DIRTY_DOZEN_CASES: DirtyDozenCase[] = [
  {
    id: 1,
    name: 'Cross-Tenant Read',
    operation: 'get',
    path: '/users/userA',
    auth: { uid: 'userB', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 2,
    name: 'Unverified Email Write',
    operation: 'create',
    path: '/users/userA',
    auth: { uid: 'userA', email_verified: false },
    payload: { ownerId: 'userA', userName: 'Muhib' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 3,
    name: 'Owner Spoofing on Alarm Create',
    operation: 'create',
    path: '/users/userA/alarms/al_1',
    auth: { uid: 'userA', email_verified: true },
    payload: { ownerId: 'userB', time: '07:00', label: 'Hack', enabled: true, days: [0], faceId: 1, melody: 'classic' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 4,
    name: 'Shadow Ghost Field Injection',
    operation: 'update',
    path: '/users/userA',
    auth: { uid: 'userA', email_verified: true },
    payload: { isAdmin: true },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 5,
    name: 'Oversized Path ID Poisoning',
    operation: 'create',
    path: `/users/userA/alarms/${'a'.repeat(180)}`,
    auth: { uid: 'userA', email_verified: true },
    payload: { ownerId: 'userA', time: '07:00', label: 'Long ID', enabled: true, days: [0], faceId: 1, melody: 'classic' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 6,
    name: 'Client-Forged Timestamp',
    operation: 'create',
    path: '/users/userA/interactions/ev_1',
    auth: { uid: 'userA', email_verified: true },
    payload: { ownerId: 'userA', dateKey: '2026-11-20', hour: 12, timestampMs: 123456, category: 'alarm', label: 'Test', source: 'portal', createdAt: '2020-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 7,
    name: 'Immutable createdAt Mutation',
    operation: 'update',
    path: '/users/userA/alarms/al_1',
    auth: { uid: 'userA', email_verified: true },
    payload: { createdAt: '2026-01-01T00:00:00Z' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 8,
    name: 'Orphaned Subcollection Write Without Parent Workspace',
    operation: 'create',
    path: '/users/orphanUser/alarms/al_1',
    auth: { uid: 'orphanUser', email_verified: true },
    payload: { ownerId: 'orphanUser', time: '07:00', label: 'Orphan', enabled: true, days: [0], faceId: 1, melody: 'classic' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 9,
    name: 'Value Poisoning on Allowed Key (Oversized userName)',
    operation: 'update',
    path: '/users/userA',
    auth: { uid: 'userA', email_verified: true },
    payload: { userName: 'x'.repeat(250) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 10,
    name: 'Array Overflow Attack on Alarm Days',
    operation: 'create',
    path: '/users/userA/alarms/al_2',
    auth: { uid: 'userA', email_verified: true },
    payload: { ownerId: 'userA', time: '08:00', label: 'Overflow', enabled: true, days: [0, 1, 2, 3, 4, 5, 6, 7], faceId: 1, melody: 'classic' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 11,
    name: 'Immutable Interaction Audit Log Tampering',
    operation: 'update',
    path: '/users/userA/interactions/ev_1',
    auth: { uid: 'userA', email_verified: true },
    payload: { label: 'Tampered' },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 12,
    name: 'Bitmap Hex Exhaustion Attack',
    operation: 'create',
    path: '/users/userA/reactions/rx_1',
    auth: { uid: 'userA', email_verified: true },
    payload: { ownerId: 'userA', name: 'TooBig', pixelsHex: 'f'.repeat(10000) },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 13,
    name: 'GIF Frames Array Overflow (> 30 frames)',
    operation: 'create',
    path: '/users/userA/gifs/gif_overflow',
    auth: { uid: 'userA', email_verified: true },
    payload: {
      ownerId: 'userA',
      name: 'too_many',
      frameDelayMs: 100,
      framesHex: Array.from({ length: 35 }, () => '0'.repeat(2048)),
      threshold: 128,
      inverted: false,
      createdAtMs: 1700000000000,
    },
    expected: 'PERMISSION_DENIED',
  },
  {
    id: 14,
    name: 'Cross-Tenant GIF Delete Attempt',
    operation: 'delete',
    path: '/users/userA/gifs/gif_1',
    auth: { uid: 'userB', email_verified: true },
    expected: 'PERMISSION_DENIED',
  },
];
