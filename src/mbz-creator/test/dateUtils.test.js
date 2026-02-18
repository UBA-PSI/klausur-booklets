const assert = require('assert');
const { parseDatetimeLocal, dateToUnixTimestamp, computeAssignmentTimestamps } = require('../lib/dateUtils');

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

    // Verify timestamps are NOT treated as UTC
    const utcEquivalent = Math.floor(Date.UTC(2026, 6, 15, 14, 30, 0) / 1000);
    const localOffset = new Date(2026, 6, 15).getTimezoneOffset() * 60;
    assert.strictEqual(ts, utcEquivalent + localOffset,
        'local timestamp should differ from UTC by the timezone offset');
    console.log(`✅ dateToUnixTimestamp differs from UTC equivalent by ${-localOffset/60} minutes (local UTC offset).`);

    if (localOffset !== 0) {
        assert.notStrictEqual(ts, utcEquivalent,
            'in a non-UTC timezone, local timestamp must differ from UTC timestamp');
        console.log('✅ Confirmed: local timestamp ≠ UTC timestamp (non-UTC timezone detected).');
    } else {
        console.log('⚠️  Running in UTC timezone — local and UTC timestamps are equal by definition.');
    }

    // --- computeAssignmentTimestamps ---

    // Returns null for empty or incomplete input
    assert.strictEqual(computeAssignmentTimestamps([]), null, 'empty array → null');
    assert.strictEqual(computeAssignmentTimestamps(null), null, 'null → null');
    assert.strictEqual(computeAssignmentTimestamps([
        { moduleId: '1', name: 'A', dateStr: '', timeStr: '17:00:00' }
    ]), null, 'missing dateStr → null');
    console.log('✅ computeAssignmentTimestamps returns null for invalid input.');

    // Single assignment — basic timestamp computation
    const single = computeAssignmentTimestamps([
        { moduleId: '10', name: 'Page 1', dateStr: '2026-07-15', timeStr: '17:00:00' }
    ], { gracePeriodMinutes: 5, openMode: 'fixed', openDurationDays: 7 });

    assert.strictEqual(single.length, 1);
    assert.strictEqual(single[0].moduleId, '10');
    assert.strictEqual(single[0].name, 'Page 1');

    // Verify due_ts is local 2026-07-15 17:00:00
    const dueDate = new Date(single[0].due_ts * 1000);
    assert.strictEqual(dueDate.getFullYear(), 2026);
    assert.strictEqual(dueDate.getMonth(), 6);
    assert.strictEqual(dueDate.getDate(), 15);
    assert.strictEqual(dueDate.getHours(), 17);
    assert.strictEqual(dueDate.getMinutes(), 0);
    console.log('✅ Single assignment: due_ts matches local 2026-07-15 17:00.');

    // cutoff = due + grace period
    assert.strictEqual(single[0].cutoff_ts, single[0].due_ts + 5 * 60,
        'cutoff should be due + 5 minutes');
    console.log('✅ Single assignment: cutoff = due + grace period.');

    // fixed mode: activation = due - openDurationDays
    assert.strictEqual(single[0].activation_ts, single[0].due_ts - 7 * 86400,
        'fixed mode: activation should be due - 7 days');
    console.log('✅ Single assignment: fixed mode activation correct.');

    // Two assignments on different dates — chain mode
    const chain = computeAssignmentTimestamps([
        { moduleId: '10', name: 'Page 1', dateStr: '2026-07-08', timeStr: '17:00:00' },
        { moduleId: '20', name: 'Page 2', dateStr: '2026-07-15', timeStr: '17:00:00' },
    ], { gracePeriodMinutes: 10, openMode: 'chain', openDurationDays: 7 });

    assert.strictEqual(chain.length, 2);

    // First group: no previous → activation = due - 7 days (falls back to fixed)
    assert.strictEqual(chain[0].activation_ts, chain[0].due_ts - 7 * 86400,
        'chain mode first group: activation = due - openDurationDays');

    // Second group: chained → activation = previous group's cutoff
    assert.strictEqual(chain[1].activation_ts, chain[0].cutoff_ts,
        'chain mode second group: activation = previous cutoff');
    console.log('✅ Chain mode: first group uses fixed fallback, second chains from previous cutoff.');

    // Two assignments on different dates — fixed mode
    const fixed = computeAssignmentTimestamps([
        { moduleId: '10', name: 'Page 1', dateStr: '2026-07-08', timeStr: '17:00:00' },
        { moduleId: '20', name: 'Page 2', dateStr: '2026-07-15', timeStr: '17:00:00' },
    ], { gracePeriodMinutes: 5, openMode: 'fixed', openDurationDays: 14 });

    assert.strictEqual(fixed[0].activation_ts, fixed[0].due_ts - 14 * 86400);
    assert.strictEqual(fixed[1].activation_ts, fixed[1].due_ts - 14 * 86400);
    console.log('✅ Fixed mode: both groups use independent activation = due - 14 days.');

    // Same-day grouping: two assignments on the same date share timestamps
    const grouped = computeAssignmentTimestamps([
        { moduleId: '10', name: 'Page 1', dateStr: '2026-07-15', timeStr: '17:00:00' },
        { moduleId: '20', name: 'Page 2', dateStr: '2026-07-15', timeStr: '17:00:00' },
        { moduleId: '30', name: 'Page 3', dateStr: '2026-07-22', timeStr: '17:00:00' },
    ], { gracePeriodMinutes: 5, openMode: 'chain', openDurationDays: 7 });

    assert.strictEqual(grouped.length, 3);
    // Page 1 and Page 2 share the same due/cutoff/activation
    assert.strictEqual(grouped[0].due_ts, grouped[1].due_ts, 'same-day: equal due_ts');
    assert.strictEqual(grouped[0].cutoff_ts, grouped[1].cutoff_ts, 'same-day: equal cutoff_ts');
    assert.strictEqual(grouped[0].activation_ts, grouped[1].activation_ts, 'same-day: equal activation_ts');
    // Page 3 chains from the shared cutoff of the first group
    assert.strictEqual(grouped[2].activation_ts, grouped[0].cutoff_ts,
        'third assignment chains from first group cutoff');
    console.log('✅ Same-day grouping: shared timestamps, chaining works across groups.');

    // Non-adjacent same-date assignments are still grouped together
    // Input order: A(07-15), B(07-22), C(07-15)
    // Output order: A, C (grouped into 07-15), then B (07-22)
    const nonAdj = computeAssignmentTimestamps([
        { moduleId: '10', name: 'A', dateStr: '2026-07-15', timeStr: '17:00:00' },
        { moduleId: '20', name: 'B', dateStr: '2026-07-22', timeStr: '17:00:00' },
        { moduleId: '30', name: 'C', dateStr: '2026-07-15', timeStr: '17:00:00' },
    ], { gracePeriodMinutes: 5, openMode: 'fixed', openDurationDays: 7 });

    assert.strictEqual(nonAdj[0].name, 'A');
    assert.strictEqual(nonAdj[1].name, 'C', 'C should be grouped with A');
    assert.strictEqual(nonAdj[2].name, 'B');
    assert.strictEqual(nonAdj[0].due_ts, nonAdj[1].due_ts,
        'non-adjacent same-date assignments share due_ts');
    assert.strictEqual(nonAdj[0].activation_ts, nonAdj[1].activation_ts,
        'non-adjacent same-date assignments share activation_ts');
    assert.notStrictEqual(nonAdj[0].due_ts, nonAdj[2].due_ts,
        'different-date assignments have different due_ts');
    console.log('✅ Non-adjacent same-date assignments grouped correctly.');

    // Grace period of 0
    const noGrace = computeAssignmentTimestamps([
        { moduleId: '10', name: 'A', dateStr: '2026-07-15', timeStr: '17:00:00' },
    ], { gracePeriodMinutes: 0, openMode: 'fixed', openDurationDays: 7 });
    assert.strictEqual(noGrace[0].cutoff_ts, noGrace[0].due_ts, 'grace=0: cutoff equals due');
    console.log('✅ Grace period of 0: cutoff equals due.');

    // Defaults (no options passed)
    const defaults = computeAssignmentTimestamps([
        { moduleId: '10', name: 'A', dateStr: '2026-07-15', timeStr: '17:00:00' },
    ]);
    assert.strictEqual(defaults[0].cutoff_ts, defaults[0].due_ts + 5 * 60,
        'default grace period should be 5 minutes');
    assert.strictEqual(defaults[0].activation_ts, defaults[0].due_ts - 7 * 86400,
        'default open duration should be 7 days (first group falls back to fixed)');
    console.log('✅ Default options work correctly.');

    console.log('\n✅ All dateUtils tests passed.');
}

if (require.main === module) {
    main();
}
