const assert = require('assert');
const { parseDatetimeLocal, dateToUnixTimestamp } = require('../lib/dateUtils');

function main() {
    // --- parseDatetimeLocal ---

    // Parsed date should have local hours/minutes matching the input
    const dt = parseDatetimeLocal('2026-07-15', '14:30:00');
    assert.strictEqual(dt.getFullYear(), 2026, 'year');
    assert.strictEqual(dt.getMonth(), 6, 'month (0-indexed)');
    assert.strictEqual(dt.getDate(), 15, 'day');
    assert.strictEqual(dt.getHours(), 14, 'hours should be local, not UTC');
    assert.strictEqual(dt.getMinutes(), 30, 'minutes');
    assert.strictEqual(dt.getSeconds(), 0, 'seconds');
    console.log('✅ parseDatetimeLocal returns correct local time components.');

    // Midnight edge case
    const midnight = parseDatetimeLocal('2026-01-01', '00:00:00');
    assert.strictEqual(midnight.getHours(), 0);
    assert.strictEqual(midnight.getDate(), 1);
    console.log('✅ parseDatetimeLocal handles midnight correctly.');

    // End-of-day edge case
    const endOfDay = parseDatetimeLocal('2026-12-31', '23:59:59');
    assert.strictEqual(endOfDay.getHours(), 23);
    assert.strictEqual(endOfDay.getMinutes(), 59);
    assert.strictEqual(endOfDay.getSeconds(), 59);
    console.log('✅ parseDatetimeLocal handles 23:59:59 correctly.');

    // Invalid input should throw
    assert.throws(() => parseDatetimeLocal('not-a-date', '14:00:00'), /Invalid date\/time/);
    assert.throws(() => parseDatetimeLocal('2026-07-15', 'not-a-time'), /Invalid date\/time/);
    console.log('✅ parseDatetimeLocal throws on invalid input.');

    // --- dateToUnixTimestamp ---

    // The Unix timestamp, converted back to a local Date, must match the input
    const ts = dateToUnixTimestamp('2026-07-15', '14:30:00');
    const roundtrip = new Date(ts * 1000);
    assert.strictEqual(roundtrip.getHours(), 14, 'roundtrip hours should be 14 local');
    assert.strictEqual(roundtrip.getMinutes(), 30, 'roundtrip minutes should be 30');
    assert.strictEqual(roundtrip.getDate(), 15, 'roundtrip day should be 15');
    console.log('✅ dateToUnixTimestamp roundtrips correctly through local time.');

    // Verify timestamps are NOT treated as UTC:
    // If we construct a UTC Date for the same wall-clock time, its timestamp
    // will differ from ours by the local UTC offset (unless we're in UTC).
    const utcEquivalent = Math.floor(Date.UTC(2026, 6, 15, 14, 30, 0) / 1000);
    const localOffset = new Date(2026, 6, 15).getTimezoneOffset() * 60; // offset in seconds (negative for east of UTC)
    assert.strictEqual(ts, utcEquivalent + localOffset,
        'local timestamp should differ from UTC by the timezone offset');
    // In CET (UTC+1) in summer (CEST, UTC+2): offset = -120 min = -7200s
    // So ts should be utcEquivalent - 7200 for CEST, or utcEquivalent - 3600 for CET
    // This assertion holds for any timezone.
    console.log(`✅ dateToUnixTimestamp differs from UTC equivalent by ${-localOffset/60} minutes (local UTC offset).`);

    // When running in a non-UTC timezone, local ts !== UTC ts
    if (localOffset !== 0) {
        assert.notStrictEqual(ts, utcEquivalent,
            'in a non-UTC timezone, local timestamp must differ from UTC timestamp');
        console.log('✅ Confirmed: local timestamp ≠ UTC timestamp (non-UTC timezone detected).');
    } else {
        console.log('⚠️  Running in UTC timezone — local and UTC timestamps are equal by definition.');
    }

    console.log('\n✅ All dateUtils tests passed.');
}

if (require.main === module) {
    main();
}
