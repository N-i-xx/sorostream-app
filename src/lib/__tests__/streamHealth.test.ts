import { describe, it, expect } from "vitest";
import {
  getStreamHealth,
  getStreamHealthDetails,
  resolveStreamHealth,
  DEFAULT_HEALTH_RULES,
  HEALTH_STATUS_PRIORITY,
  EXPIRING_SOON_THRESHOLD_MS,
  type HealthStatusRule,
  type HealthStreamInput,
  type StreamHealthStatus,
} from "../streamHealth";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal HealthStreamInput with sensible defaults. */
function makeStream(
  overrides: Partial<HealthStreamInput> & { endOffsetMs?: number } = {},
): HealthStreamInput {
  const { endOffsetMs = EXPIRING_SOON_THRESHOLD_MS * 2, ...rest } = overrides;
  return {
    status: "Active",
    endTime: new Date(NOW + endOffsetMs).toISOString(),
    ...rest,
  };
}

const NOW = 1_700_000_000_000; // fixed timestamp (ms) for all tests

// ---------------------------------------------------------------------------
// 1. All status variants — basic smoke tests
// ---------------------------------------------------------------------------

describe("getStreamHealth — status variants", () => {
  it("returns 'Active' for a running stream with endTime far in the future", () => {
    const stream = makeStream({ endOffsetMs: EXPIRING_SOON_THRESHOLD_MS * 3 });
    expect(getStreamHealth(stream, NOW)).toBe("Active");
  });

  it("returns 'Expiring Soon' for a stream ending within 24 hours", () => {
    // 1 second before the threshold boundary
    const stream = makeStream({ endOffsetMs: EXPIRING_SOON_THRESHOLD_MS - 1000 });
    expect(getStreamHealth(stream, NOW)).toBe("Expiring Soon");
  });

  it("returns 'Expired' for a stream whose endTime has already passed", () => {
    const stream = makeStream({ endOffsetMs: -1000 }); // 1 second in the past
    expect(getStreamHealth(stream, NOW)).toBe("Expired");
  });

  it("returns 'Expired' when status is 'Ended' regardless of endTime", () => {
    // endTime is in the future, but status says Ended
    const stream = makeStream({ status: "Ended", endOffsetMs: 86400000 });
    expect(getStreamHealth(stream, NOW)).toBe("Expired");
  });

  it("returns 'Paused' for a paused stream", () => {
    const stream = makeStream({ status: "Paused" });
    expect(getStreamHealth(stream, NOW)).toBe("Paused");
  });

  it("returns 'Cancelled' for a cancelled stream", () => {
    const stream = makeStream({ status: "Cancelled" });
    expect(getStreamHealth(stream, NOW)).toBe("Cancelled");
  });
});

// ---------------------------------------------------------------------------
// 2. Boundary conditions — time-based transitions
// ---------------------------------------------------------------------------

describe("getStreamHealth — boundary conditions", () => {
  it("returns 'Active' when endTime is exactly at EXPIRING_SOON_THRESHOLD_MS from now", () => {
    // At exactly the threshold the stream has 24 h remaining — NOT expiring soon yet
    const stream: HealthStreamInput = {
      status: "Active",
      endTime: new Date(NOW + EXPIRING_SOON_THRESHOLD_MS).toISOString(),
    };
    // endMs - now === threshold → NOT <= threshold
    expect(getStreamHealth(stream, NOW)).toBe("Active");
  });

  it("returns 'Expiring Soon' when endTime is 1 ms inside the threshold", () => {
    const stream: HealthStreamInput = {
      status: "Active",
      endTime: new Date(NOW + EXPIRING_SOON_THRESHOLD_MS - 1).toISOString(),
    };
    expect(getStreamHealth(stream, NOW)).toBe("Expiring Soon");
  });

  it("returns 'Expired' when endTime equals now (stream ends exactly at this moment)", () => {
    const stream: HealthStreamInput = {
      status: "Active",
      endTime: new Date(NOW).toISOString(),
    };
    // now >= endMs (equal), so Expired
    expect(getStreamHealth(stream, NOW)).toBe("Expired");
  });

  it("returns 'Active' when endTime is 1 ms in the future beyond the threshold", () => {
    const stream: HealthStreamInput = {
      status: "Active",
      endTime: new Date(NOW + EXPIRING_SOON_THRESHOLD_MS + 1).toISOString(),
    };
    expect(getStreamHealth(stream, NOW)).toBe("Active");
  });

  it("returns 'Expired' for endTime 1 second before now", () => {
    const stream: HealthStreamInput = {
      status: "Active",
      endTime: new Date(NOW - 1000).toISOString(),
    };
    expect(getStreamHealth(stream, NOW)).toBe("Expired");
  });

  it("returns 'Expired' for an unparseable endTime string", () => {
    const stream: HealthStreamInput = {
      status: "Active",
      endTime: "not-a-date",
    };
    expect(getStreamHealth(stream, NOW)).toBe("Expired");
  });
});

// ---------------------------------------------------------------------------
// 3. Paused overrides time-based calculations
// ---------------------------------------------------------------------------

describe("getStreamHealth — Paused overrides time-based status", () => {
  it("returns 'Paused' even when endTime is already past", () => {
    const stream: HealthStreamInput = {
      status: "Paused",
      endTime: new Date(NOW - 1000).toISOString(), // ended 1 second ago
    };
    expect(getStreamHealth(stream, NOW)).toBe("Paused");
  });

  it("returns 'Paused' even when stream would otherwise be 'Expiring Soon'", () => {
    const stream: HealthStreamInput = {
      status: "Paused",
      endTime: new Date(NOW + 3600_000).toISOString(), // 1 hour → expiring soon
    };
    expect(getStreamHealth(stream, NOW)).toBe("Paused");
  });

  it("returns 'Paused' even when endTime is far in the future (would be Active)", () => {
    const stream: HealthStreamInput = {
      status: "Paused",
      endTime: new Date(NOW + EXPIRING_SOON_THRESHOLD_MS * 10).toISOString(),
    };
    expect(getStreamHealth(stream, NOW)).toBe("Paused");
  });
});

// ---------------------------------------------------------------------------
// 4. Cancelled overrides everything — including Paused
// ---------------------------------------------------------------------------

describe("getStreamHealth — Cancelled overrides all statuses", () => {
  it("returns 'Cancelled' when status is Cancelled and endTime is in the future", () => {
    const stream: HealthStreamInput = {
      status: "Cancelled",
      endTime: new Date(NOW + EXPIRING_SOON_THRESHOLD_MS * 5).toISOString(),
    };
    expect(getStreamHealth(stream, NOW)).toBe("Cancelled");
  });

  it("returns 'Cancelled' when status is Cancelled and endTime is in the past", () => {
    const stream: HealthStreamInput = {
      status: "Cancelled",
      endTime: new Date(NOW - 86400_000).toISOString(), // 1 day ago
    };
    expect(getStreamHealth(stream, NOW)).toBe("Cancelled");
  });

  it("returns 'Cancelled' when status is Cancelled and endTime is unparseable", () => {
    const stream: HealthStreamInput = {
      status: "Cancelled",
      endTime: "garbage",
    };
    expect(getStreamHealth(stream, NOW)).toBe("Cancelled");
  });
});

// ---------------------------------------------------------------------------
// 5. Optional cliffTime field — does not affect status computation (pass-through)
// ---------------------------------------------------------------------------

describe("getStreamHealth — streams with cliff metadata", () => {
  it("still returns 'Active' when cliff is in the future", () => {
    const stream: HealthStreamInput = {
      status: "Active",
      endTime: new Date(NOW + EXPIRING_SOON_THRESHOLD_MS * 4).toISOString(),
      cliffTime: new Date(NOW + 3600_000).toISOString(), // 1 hour from now
    };
    expect(getStreamHealth(stream, NOW)).toBe("Active");
  });

  it("still returns 'Expiring Soon' with a past cliff date", () => {
    const stream: HealthStreamInput = {
      status: "Active",
      endTime: new Date(NOW + 3600_000).toISOString(), // 1 hour → expiring soon
      cliffTime: new Date(NOW - 3600_000).toISOString(), // cliff already passed
    };
    expect(getStreamHealth(stream, NOW)).toBe("Expiring Soon");
  });
});

// ---------------------------------------------------------------------------
// 6. Default `now` parameter uses real clock
// ---------------------------------------------------------------------------

describe("getStreamHealth — real-clock default", () => {
  it("uses Date.now() when `now` is omitted and correctly classifies an active stream", () => {
    const farFuture = new Date(Date.now() + EXPIRING_SOON_THRESHOLD_MS * 5).toISOString();
    const stream: HealthStreamInput = { status: "Active", endTime: farFuture };
    expect(getStreamHealth(stream)).toBe("Active");
  });

  it("uses Date.now() when `now` is omitted and classifies a past-ended stream as Expired", () => {
    const past = new Date(Date.now() - 10_000).toISOString();
    const stream: HealthStreamInput = { status: "Active", endTime: past };
    expect(getStreamHealth(stream)).toBe("Expired");
  });
});

// ---------------------------------------------------------------------------
// 7. Expired streams with and without an unclaimed balance (#717)
// ---------------------------------------------------------------------------

describe("getStreamHealthDetails — unclaimed balance on Expired streams", () => {
  const ended: HealthStreamInput = {
    status: "Active",
    endTime: new Date(NOW - 1000).toISOString(),
  };

  it("distinguishes an expired stream with funds left from a fully claimed one", () => {
    const withFunds = getStreamHealthDetails(ended, 5_000_000, NOW);
    const claimed = getStreamHealthDetails(ended, 0, NOW);

    expect(withFunds.status).toBe("Expired");
    expect(claimed.status).toBe("Expired");
    expect(withFunds.hasUnclaimedBalance).toBe(true);
    expect(claimed.hasUnclaimedBalance).toBe(false);
  });

  it("accepts the string amounts returned by claimableNow", () => {
    expect(getStreamHealthDetails(ended, "1", NOW).hasUnclaimedBalance).toBe(true);
    expect(getStreamHealthDetails(ended, "0", NOW).hasUnclaimedBalance).toBe(false);
    expect(getStreamHealthDetails(ended, "not-a-number", NOW).hasUnclaimedBalance).toBe(false);
  });

  it("treats an 'Ended' status the same way", () => {
    const stream = makeStream({ status: "Ended" });
    expect(getStreamHealthDetails(stream, 10, NOW)).toEqual({
      status: "Expired",
      hasUnclaimedBalance: true,
    });
  });

  it("keeps the priority order and only flags Expired streams", () => {
    const cases: Array<[HealthStreamInput, string]> = [
      [{ status: "Cancelled", endTime: new Date(NOW - 1000).toISOString() }, "Cancelled"],
      [{ status: "Paused", endTime: new Date(NOW - 1000).toISOString() }, "Paused"],
      [makeStream({ endOffsetMs: 3600_000 }), "Expiring Soon"],
      [makeStream({ endOffsetMs: EXPIRING_SOON_THRESHOLD_MS * 3 }), "Active"],
    ];
    for (const [stream, status] of cases) {
      const details = getStreamHealthDetails(stream, 10, NOW);
      expect(details.status).toBe(status);
      expect(details.status).toBe(getStreamHealth(stream, NOW));
      expect(details.hasUnclaimedBalance).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// 8. Extensible priority chain — injected application-specific statuses (#688)
// ---------------------------------------------------------------------------

/** A stream shape carrying a field this module knows nothing about. */
type AppStream = HealthStreamInput & { disputed?: boolean; underReview?: boolean };

type AppStatus = "Disputed" | "Under Review";

/** Sits between Paused (400) and Expired (300) — above every time-based state. */
const DISPUTED_RULE: HealthStatusRule<AppStatus> = {
  status: "Disputed",
  priority: HEALTH_STATUS_PRIORITY.Paused - 50, // 350
  matches: ({ stream }) => (stream as AppStream).disputed === true,
};

/** Sits between Expiring Soon (200) and Active (100). */
const UNDER_REVIEW_RULE: HealthStatusRule<AppStatus> = {
  status: "Under Review",
  priority: HEALTH_STATUS_PRIORITY["Expiring Soon"] - 50, // 150
  matches: ({ stream }) => (stream as AppStream).underReview === true,
};

function makeAppStream(overrides: Partial<AppStream> & { endOffsetMs?: number } = {}): AppStream {
  const { endOffsetMs = EXPIRING_SOON_THRESHOLD_MS * 2, ...rest } = overrides;
  return {
    status: "Active",
    endTime: new Date(NOW + endOffsetMs).toISOString(),
    ...rest,
  };
}

describe("resolveStreamHealth — injected status rules (#688)", () => {
  it("resolves an injected status at its declared priority, above Expired", () => {
    const stream = makeAppStream({ disputed: true, endOffsetMs: -1000 });

    // Without the rule the stream is Expired…
    expect(getStreamHealth(stream, NOW)).toBe("Expired");
    // …with it, Disputed wins because 350 > 300 (Expired).
    expect(resolveStreamHealth(stream, NOW, [DISPUTED_RULE])).toBe("Disputed");
  });

  it("still loses to higher-priority built-ins (Paused, Cancelled)", () => {
    expect(
      resolveStreamHealth(makeAppStream({ disputed: true, status: "Paused" }), NOW, [
        DISPUTED_RULE,
      ]),
    ).toBe("Paused");

    expect(
      resolveStreamHealth(makeAppStream({ disputed: true, status: "Cancelled" }), NOW, [
        DISPUTED_RULE,
      ]),
    ).toBe("Cancelled");
  });

  it("beats lower-priority built-ins (Expiring Soon, Active)", () => {
    expect(
      resolveStreamHealth(makeAppStream({ disputed: true, endOffsetMs: 3600_000 }), NOW, [
        DISPUTED_RULE,
      ]),
    ).toBe("Disputed");

    expect(
      resolveStreamHealth(makeAppStream({ disputed: true }), NOW, [DISPUTED_RULE]),
    ).toBe("Disputed");
  });

  it("orders multiple injected rules against each other by priority", () => {
    const stream = makeAppStream({ disputed: true, underReview: true });
    expect(resolveStreamHealth(stream, NOW, [UNDER_REVIEW_RULE, DISPUTED_RULE])).toBe(
      "Disputed",
    );

    // Reverse registration order — priority still decides.
    expect(resolveStreamHealth(stream, NOW, [DISPUTED_RULE, UNDER_REVIEW_RULE])).toBe(
      "Disputed",
    );
  });

  it("falls through to the built-in chain when an injected rule does not match", () => {
    expect(resolveStreamHealth(makeAppStream(), NOW, [DISPUTED_RULE, UNDER_REVIEW_RULE])).toBe(
      "Active",
    );
  });

  it("leaves the default five-status behaviour untouched", () => {
    const streams: HealthStreamInput[] = [
      makeStream({ status: "Cancelled", endOffsetMs: 0 }),
      makeStream({ status: "Paused", endOffsetMs: 0 }),
      makeStream({ status: "Ended" }),
      makeStream({ endOffsetMs: -1000 }),
      makeStream({ endOffsetMs: 3600_000 }),
      makeStream({ endOffsetMs: EXPIRING_SOON_THRESHOLD_MS * 3 }),
      { status: "Active", endTime: "not-a-date" },
    ];

    for (const stream of streams) {
      expect(resolveStreamHealth(stream, NOW)).toBe(getStreamHealth(stream, NOW));
      expect(resolveStreamHealth(stream, NOW, [])).toBe(getStreamHealth(stream, NOW));
    }
  });

  it("ships the documented default rule order", () => {
    expect(DEFAULT_HEALTH_RULES.map((rule) => rule.status)).toEqual([
      "Cancelled",
      "Paused",
      "Expired",
      "Expiring Soon",
      "Active",
    ]);

    const priorities = DEFAULT_HEALTH_RULES.map((rule) => rule.priority);
    expect(priorities).toEqual([
      HEALTH_STATUS_PRIORITY.Cancelled,
      HEALTH_STATUS_PRIORITY.Paused,
      HEALTH_STATUS_PRIORITY.Expired,
      HEALTH_STATUS_PRIORITY["Expiring Soon"],
      HEALTH_STATUS_PRIORITY.Active,
    ]);
    // Strictly descending: every built-in outranks the one below it.
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i - 1]).toBeGreaterThan(priorities[i]);
    }
  });

  it("passes injected rules through getStreamHealthDetails", () => {
    const disputedExpired = getStreamHealthDetails(
      makeAppStream({ disputed: true, endOffsetMs: -1000 }),
      5_000_000,
      NOW,
      [DISPUTED_RULE],
    );
    expect(disputedExpired).toEqual({
      status: "Disputed",
      // Only a literal "Expired" status carries an unclaimed-balance badge.
      hasUnclaimedBalance: false,
    });

    const plainExpired = getStreamHealthDetails(
      makeAppStream({ endOffsetMs: -1000 }),
      5_000_000,
      NOW,
      [DISPUTED_RULE],
    );
    expect(plainExpired).toEqual({ status: "Expired", hasUnclaimedBalance: true });
  });

  it("keeps the return type limited to the declared statuses", () => {
    // Type-level assertions: the helper still narrows to the built-in union,
    // while resolveStreamHealth widens by exactly the injected statuses.
    const status: StreamHealthStatus = getStreamHealth(makeStream(), NOW);
    const resolved: StreamHealthStatus | AppStatus = resolveStreamHealth(makeStream(), NOW, [
      DISPUTED_RULE,
    ]);
    expect(["Active", status, resolved]).toContain("Active");
  });
});
