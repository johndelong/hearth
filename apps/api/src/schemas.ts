const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] } as const;

/** A bounded nullable string, for text that is passed on to Google. */
const nullableText = (maxLength: number) =>
  ({ anyOf: [{ type: 'string', maxLength }, { type: 'null' }] }) as const;

export const personBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    hue: { type: 'integer', minimum: -1, maximum: 360 },
    role: { enum: ['kid', 'parent'] },
    bday: nullableString,
    byear: { anyOf: [{ type: 'integer', minimum: 1900, maximum: 2200 }, { type: 'null' }] },
    onChores: { type: 'boolean' },
    onCal: { type: 'boolean' },
    goalRewardId: nullableString,
    avatarUrl: nullableString,
    avatarKey: nullableString,
    sortOrder: { type: 'integer', minimum: 0 },
  },
} as const;

const recurrence = {
  type: 'object',
  additionalProperties: false,
  required: ['freq', 'interval', 'byDay', 'byMonthDay', 'bySetPos', 'startsOn'],
  properties: {
    freq: { enum: ['daily', 'weekly', 'monthly', 'yearly'] },
    interval: { type: 'integer', minimum: 1, maximum: 999 },
    byDay: { type: 'array', uniqueItems: true, items: { type: 'integer', minimum: 0, maximum: 6 } },
    byMonthDay: { anyOf: [{ type: 'integer', minimum: 1, maximum: 31 }, { type: 'null' }] },
    bySetPos: { anyOf: [{ enum: [1, 2, 3, 4, -1] }, { type: 'null' }] },
    startsOn: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
    until: { anyOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, { type: 'null' }] },
  },
} as const;

export const choreBody = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    personIds: { type: 'array', uniqueItems: true, items: { type: 'string', minLength: 1 } },
    description: nullableString,
    instructions: nullableString,
    recurrence,
    timeOfDay: { enum: ['morning', 'afternoon', 'evening', 'any'] },
    active: { type: 'boolean' },
    sortOrder: { type: 'integer', minimum: 0 },
  },
} as const;

export const extraBody = {
  type: 'object', additionalProperties: false,
  properties: {
    title: { type: 'string', minLength: 1, maxLength: 120 },
    description: nullableString,
    instructions: nullableString,
    points: { type: 'integer', minimum: 0, maximum: 100000 },
    active: { type: 'boolean' },
  },
} as const;

export const rewardBody = {
  type: 'object', additionalProperties: false,
  properties: {
    label: { type: 'string', minLength: 1, maxLength: 120 },
    cost: { type: 'integer', minimum: 1, maximum: 1000000 },
    active: { type: 'boolean' },
    imageUrl: nullableString,
    icon: nullableString,
  },
} as const;

export const pointAdjustBody = {
  type: 'object', additionalProperties: false,
  required: ['personId', 'delta'],
  properties: {
    personId: { type: 'string', minLength: 1 },
    // Bounded and non-zero: a zero adjustment is a ledger entry that explains
    // nothing, and the bounds keep a mis-typed number from wrecking a balance.
    delta: { type: 'integer', minimum: -100000, maximum: 100000, not: { const: 0 } },
    reason: { type: 'string', minLength: 1, maxLength: 200 },
  },
} as const;

export const eventAttendeesBody = {
  type: 'object', additionalProperties: false,
  required: ['personIds'],
  properties: {
    personIds: { type: 'array', uniqueItems: true, maxItems: 64, items: { type: 'string', minLength: 1 } },
  },
} as const;

export const settingsBody = {
  type: 'object', additionalProperties: false,
  properties: {
    weekStart: { enum: ['Sunday', 'Monday'] },
    dayHours: { enum: ['6a – 10p', '7a – 9p', 'All 24'] },
    showAllDay: { type: 'boolean' }, birthdaysOnCal: { type: 'boolean' },
    choreReset: { enum: ['Every night', 'Sunday', 'Monday'] },
    claimExtras: { type: 'boolean' }, choreConfetti: { type: 'boolean' },
    theme: { enum: ['Auto', 'Day', 'Night'] },
    idleMin: { type: 'integer', minimum: 0, maximum: 1440 },
    playful: { type: 'boolean' }, navModel: { enum: ['sidebar', 'tabs'] },
  },
} as const;

export const eventBody = {
  type: 'object', additionalProperties: false,
  properties: {
    calendarId: { type: 'string', minLength: 1 },
    title: { type: 'string', minLength: 1, maxLength: 500 },
    start: { type: 'string', minLength: 10 }, end: { type: 'string', minLength: 10 },
    allDay: { type: 'boolean' },
    // Bounded here rather than left to Google, whose rejection would surface as
    // a 500 on a request that was always going to be refused.
    location: nullableText(1024), description: nullableText(8192),
    // Hearth's own, never forwarded to Google — see migration 018.
    personIds: { type: 'array', uniqueItems: true, maxItems: 64, items: { type: 'string', minLength: 1 } },
    recurrence: { anyOf: [recurrence, { type: 'null' }] },
    /** Which of a repeating event a write is aimed at. */
    scope: { enum: ['this', 'all'] },
  },
} as const;
