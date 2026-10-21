# Create-Stream Form Validation

This document describes how validation works on the create-stream wizard
(`/stream/new`), what the rules for each field are, and the invariants that
any change to that surface must preserve.

It exists because the wizard used to derive its error messages from several
independent code paths that could disagree with each other. The result was
error text that did not match what the user had typed. See
[Known problems](#known-problems) for the specific regressions that were fixed
under issue #599, and [Invariants](#invariants) for the rules that now keep
the paths in sync.

## Files involved

- **`src/app/stream/new/page.tsx`** — the wizard itself. Owns the `errors` and
  `touched` state, the field validators, and every handler that writes an
  error message.
- **`src/app/stream/new/__tests__/formErrorClearing.test.tsx`** — regression
  tests for the error-clearing behaviour.
- **`src/lib/useFormPersist.ts`** — persists the form as a draft in
  `sessionStorage`. The draft is restored on the next visit, so a field can
  arrive pre-filled with a value that is already invalid.
- **`src/lib/addressBook.ts`** — owns the recipient whitelist (the
  "approved list") that the recipient rule consults.

## The validation model

### Two pieces of state

| State | Shape | Meaning |
| --- | --- | --- |
| `errors` | `{ recipient, amount, duration, endDate, cliffDate, scheduledStart }` | The message currently shown for each field. Empty string means "no message". |
| `touched` | `{ recipient, amount }` | Whether the user has interacted with the field. Used to decide whether a message may be *raised*, never to decide whether one may be *cleared*. |

### Pure validators

These are module-level functions that take a value and return a message, or an
empty string when the value is acceptable. They hold no state and perform no
I/O.

| Function | Rule |
| --- | --- |
| `validateRecipient(value)` | Non-empty, and a valid Stellar public key (`G` + 55 base32 characters). |
| `validateAmount(value)` | Non-empty, numeric, positive. |
| `validateDuration(seconds)` | Greater than zero. |
| `validateEndDate(value)` | Optional. If set, must parse and be in the future. |
| `validateCliffDate(cliff, end)` | Optional. If set, must parse, be in the future, and precede the end date. |
| `validateScheduledStart(value)` | Required while scheduling is enabled, and must be in the future. |

### Field validators

Two fields have more than one rule, so each combines its rules in a single
component-level function. These are the **single source of truth** for those
fields' messages — the blur handlers, the change handlers and the submit paths
all call them, so they cannot disagree.

| Function | Combines |
| --- | --- |
| `validateRecipientField(value)` | `validateRecipient(value)` plus the recipient whitelist check from `addressBook.ts` (#432). |
| `validateAmountField(value)` | `validateAmount(value)` plus the contract's maximum deposit cap (#526). The cap is only enforced once `getStreamCapConfig()` has resolved and reported a non-zero limit. |

The whitelist rule lives in `whitelistErrorFor(value)` rather than being
inlined, because it has to be evaluated against the value the user is
*currently typing* and not only against the committed `recipient` state.

### When a message is raised

A message is raised for a field in three situations:

1. **On blur** — `handleRecipientBlur` and `handleAmountBlur` mark the field
   touched and set the message from the field validator.
2. **On "Next"** — `goNext` validates every field on the current step and
   returns early without advancing if any of them fails.
3. **On "Confirm"** — `handleCreateStream` validates every field before it
   will sign a transaction.

Cases 2 and 3 also mark the amount as touched, so that the user's next edit
re-validates it (see [Invariants](#invariants)).

### When a message is cleared

`revalidate(field, value, validate)` is the single entry point for reacting to
an edit. It re-runs the field's validator and replaces the message with the
result, which clears it when the value has become acceptable and refreshes it
when the value is still invalid.

It is called from the recipient `onChange`, the amount `onChange` and the
amount `onPaste`. Paste is an edit like any other and must go through the
same path — an earlier version of the form only re-validated on paste when the
field happened to be touched already, which let a stale message survive a
pasted correction.

`revalidate` deliberately does **not** raise a message for a field that has
never been touched and has no message on screen. This keeps the form from
shouting at a user who is still halfway through typing an address.

## Invariants

Any change to this surface should preserve the following.

1. **One source of truth per field.** A field's message is produced by exactly
   one validator, and every path that can show a message for that field —
   blur, change, paste, "Next", "Confirm" — calls it. If two validators can
   produce a message for the same field, they will eventually disagree.

2. **Raising a message marks the field touched.** Any path that sets a
   non-empty message for a field must also mark that field as touched. If it
   does not, the next edit takes the "untouched" branch and either clears the
   message blindly or skips re-validation entirely.

3. **Every edit re-validates.** Typing, pasting and any programmatic value
   change go through `revalidate`. A path that sets a field's value without
   re-validating it will leave a stale message behind.

4. **Never raise a message before the field has been left once.** `revalidate`
   only produces a message for a field that is already touched or already
   showing one.

5. **One error channel per field.** Do not add a second piece of state that
   holds a message for a field that `errors` already covers. An earlier
   version of the form kept the deposit-cap message in a separate `capError`
   state that was never cleared alongside `errors.amount`, so the two could
   drift apart. The cap rule now lives inside `validateAmountField`.

## Known problems

These were the concrete regressions fixed under issue #599. They are listed
because they are the shapes of bug the invariants above exist to prevent.

### A stale message survived a correction

"Next" and "Confirm" raised an amount message without marking the amount as
touched. The next edit therefore took the untouched branch, which cleared the
message *without checking the new value* — so the message could disappear
while the amount was still invalid, and could equally survive a paste that
made the amount valid.

```tsx
// Before — the pasted value was never re-validated unless the field
// happened to be touched already.
if (touched.amount) {
  setErrors((prev) => ({ ...prev, amount: validateAmount(cleaned) }));
}
```

```tsx
// After — every edit re-validates through one path.
revalidate("amount", cleaned, validateAmountField);
```

### A message vanished while the input was still invalid

The recipient field cleared its message unconditionally on every keystroke, so
an invalid address looked valid until the next blur — at which point the
message reappeared.

```tsx
// Before — the message was dropped on the first keystroke, whatever the value.
setErrors((prev) => ({ ...prev, recipient: "" }));
```

```tsx
// After — the message always describes the current value.
revalidate("recipient", v, validateRecipientField);
```

### The duration message went stale

The duration handler cleared its message only when the new duration was
greater than zero and never re-validated otherwise, so a message could
outlive the value that produced it.

### The deposit cap had a second error channel

The cap check lived outside the amount validator and wrote to a separate
`capError` state that was never cleared together with `errors.amount`. It is
now part of `validateAmountField`.

### Two smaller issues fixed alongside

- **The amount was not persisted after a paste.** The input was updated but the
  saved draft was not, so a pasted amount was lost on reload.
- **The "Save to address book" button was hidden by the whitelist rejection
  it resolves.** The address-book status block was keyed off any recipient
  error; it is now keyed off the address *format*, so the quick-save action
  stays reachable exactly when the user needs it.

## Testing

```bash
npx vitest run src/app/stream/new/
```

`formErrorClearing.test.tsx` covers the behaviours described above:

| Test | Covers |
| --- | --- |
| clears the recipient error once the address is corrected | a message is dropped once the value becomes valid |
| re-runs recipient validation on every input change | the message tracks the current value instead of disappearing |
| does not raise a recipient error before the field has been left | invariant 4 |
| clears the amount error once the amount is corrected | the basic clearing path |
| clears an amount error raised by "Next" once the amount is corrected | invariant 2 |
| re-validates a pasted amount so a stale error does not survive | invariant 3 |
| keeps the amount error visible while the amount is still invalid | the message is refreshed, not dropped |
| keeps the amount error accurate when it was raised by "Next" | the message still describes the current value |

Three of these fail against the code as it was before the fix.

When adding a field or a rule, add a test here alongside it. The cases worth
covering are: the message is raised on blur, the message is cleared when the
value becomes valid, and the message is refreshed — not dropped — when the
value stays invalid.

## Related work

- **#599** — the issue this fix was made under.
- **#432** — the recipient whitelist that `validateRecipientField` enforces.
- **#526** — the contract deposit cap that `validateAmountField` enforces.
- **#428** — the typed confirmation required for large amounts. It is a
  separate guard and is not part of the `errors` state.
