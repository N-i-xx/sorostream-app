import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FORM_DRAFT_KEY,
  FORM_DRAFT_SCHEMA_VERSION,
  readDraft,
  useFormPersist,
  writeDraft,
  type CreateStreamDraft,
} from "@/src/lib/useFormPersist";

const draft: CreateStreamDraft = {
  recipient: "GB7B2XS7YYUWVLXUYG6EWBEYHV4WTUY5VWFDOXWOITVNHAJBMMRV7ZGO",
  amount: "25",
  duration: 86_400,
  selectedToken: "USDC",
  customTokenAddress: "",
  endDate: "",
  cliffDate: "",
};

describe("useFormPersist", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("persists a draft after the debounce window during normal editing", () => {
    const { result } = renderHook(() => useFormPersist());

    act(() => result.current.saveDraft(draft));
    expect(window.sessionStorage.getItem(FORM_DRAFT_KEY)).toBeNull();

    act(() => vi.advanceTimersByTime(150));
    expect(readDraft()).toEqual(draft);
  });

  it("does not resurrect a draft when clearDraft runs while a debounced write is pending", () => {
    const { result } = renderHook(() => useFormPersist());

    act(() => result.current.saveDraft(draft));
    act(() => result.current.clearDraft());
    act(() => vi.advanceTimersByTime(150));

    expect(window.sessionStorage.getItem(FORM_DRAFT_KEY)).toBeNull();
    expect(readDraft()).toBeNull();
  });

  it("writes the current schema version alongside the draft", () => {
    writeDraft(draft);

    expect(JSON.parse(window.sessionStorage.getItem(FORM_DRAFT_KEY)!)).toEqual({
      version: FORM_DRAFT_SCHEMA_VERSION,
      draft,
    });
    expect(readDraft()).toEqual(draft);
  });

  it("discards an old-shape draft that has no schema version", () => {
    // Shape written before versioning was introduced (#693).
    window.sessionStorage.setItem(FORM_DRAFT_KEY, JSON.stringify(draft));

    expect(readDraft()).toBeNull();
    expect(window.sessionStorage.getItem(FORM_DRAFT_KEY)).toBeNull();
  });

  it("discards a draft saved under a different schema version", () => {
    window.sessionStorage.setItem(
      FORM_DRAFT_KEY,
      JSON.stringify({ version: FORM_DRAFT_SCHEMA_VERSION + 1, draft }),
    );

    expect(readDraft()).toBeNull();
    expect(window.sessionStorage.getItem(FORM_DRAFT_KEY)).toBeNull();
  });

  it("discards a current-version draft whose payload has the wrong shape", () => {
    window.sessionStorage.setItem(
      FORM_DRAFT_KEY,
      JSON.stringify({
        version: FORM_DRAFT_SCHEMA_VERSION,
        draft: { recipient: "G...", amount: 25 },
      }),
    );

    expect(readDraft()).toBeNull();
    expect(window.sessionStorage.getItem(FORM_DRAFT_KEY)).toBeNull();
  });

  it("keeps persisting new edits made after a clear", () => {
    const { result } = renderHook(() => useFormPersist());

    act(() => result.current.saveDraft(draft));
    act(() => result.current.clearDraft());

    const nextDraft = { ...draft, amount: "50" };
    act(() => result.current.saveDraft(nextDraft));
    act(() => vi.advanceTimersByTime(150));

    expect(readDraft()).toEqual(nextDraft);
  });
});
