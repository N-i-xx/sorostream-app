"use client";
import { primePickerToNow } from "@/src/lib/datePickerDefault";
import { formatLocaleDate, formatLocaleDateTime } from "@/src/lib/dateFormat";
import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DurationPicker from "@/components/DurationPicker";
import EndDatePicker from "@/components/EndDatePicker";
import FlowRatePreview from "@/components/FlowRatePreview";
import AssetConversionPreview from "@/components/AssetConversionPreview";
import StreamTemplatePicker from "@/components/StreamTemplatePicker";
import RecipientAutocomplete from "@/components/RecipientAutocomplete";
import VestingPreviewChart from "@/components/VestingPreviewChart";
import TransactionStepper, { TxStage } from "@/components/TransactionStepper";
import SchedulingToggle from "@/components/SchedulingToggle";
import FeeEstimationPanel from "@/components/FeeEstimationPanel";
import StreamCostCalculator from "@/components/StreamCostCalculator";
import StreamRateCalculator from "@/components/StreamRateCalculator";
import BatchCreateTab from "@/components/BatchCreateTab";
import NetReceivedDisplay from "@/components/NetReceivedDisplay";
import StreamDryRunPreview from "@/components/StreamDryRunPreview";
import AddressVerificationBadge from "@/components/AddressVerificationBadge";
import AddressVerificationWarning from "@/components/AddressVerificationWarning";
import { SkeletonForm } from "@/components/Skeleton";
import Tooltip from "@/components/ui/Tooltip";
import { useTranslations } from "@/src/lib/i18n";
import { trackEvent } from "@/src/lib/analytics";
import { verifyAddress, canCreateStream, type AddressVerification } from "@/src/lib/addressVerification";
import { sorostream, getFeeConfig, calcWithdrawBreakdown, validateMetadataUri, getCollateralConfig, checkIsNewSender, calcCollateral, getGasFeeEstimate, getStreamCapConfig, type GasFeeEstimate } from "@/src/lib/sorostream";
import { getContacts, saveContact, isRecipientApproved, isWhitelistEnforced, type AddressBookContact } from "@/src/lib/addressBook";
import { useWallet } from "@/src/context/WalletContext";
import { getOptionalEnvVar } from "@/src/lib/env";
import { readDraft, useFormPersist } from "@/src/lib/useFormPersist";
import { useUnsavedChangesWarning } from "@/src/lib/useUnsavedChangesWarning";
import { usePreferences } from "@/src/context/PreferencesContext";

type PageTab = "single" | "batch";
import { useSettings } from "@/src/context/SettingsContext";

type Step = "recipient" | "amount" | "preview" | "review";

const SUPPORTED_TOKENS = [
  { symbol: "USDC", name: "USD Coin",        address: "CAQCFVLOBK5GIULPNZRGATJJMIZL5BSP7X5YJVMGCPTUEPFM4AVSRCJU" },
  { symbol: "XLM",  name: "Stellar Lumens",  address: "native" },
  { symbol: "AQUA", name: "Aquarius",        address: "GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA" },
  { symbol: "yXLM", name: "Yield XLM",       address: "GARDNV3Q7YGT4AKSDF25LT32YSCCW4EV22Y2TV3I2PU2MMXJTEDL5T55" },
] as const;

const CUSTOM_TOKEN_VALUE = "__custom__";

function validateRecipient(value: string): string {
  if (!value) return "Recipient address is required.";
  if (!/^G[A-Z2-7]{55}$/.test(value))
    return "Must be a valid Stellar public key (starts with G, 56 chars).";
  return "";
}

function validateAmount(value: string): string {
  if (!value) return "Amount is required.";
  // Check if value contains a minus sign (negative number)
  if (value.includes("-")) return "Amount must be a positive number.";
  if (!/^\d*\.?\d*$/.test(value.trim())) return "Amount must contain only numbers.";
  const numValue = Number(value);
  if (isNaN(numValue) || numValue <= 0) return "Amount must be greater than 0.";
  return "";
}

function validateDuration(seconds: number): string {
  if (seconds <= 0) return "Duration must be greater than 0.";
  return "";
}

/**
 * Validates an optional end-date ISO string.
 * Returns an error if the value is provided but points to the past.
 */
function validateEndDate(value: string): string {
  if (!value) return "";
  const ts = new Date(value).getTime();
  if (isNaN(ts)) return "Invalid date.";
  if (ts <= Date.now()) return "End date must be in the future.";
  return "";
}

/**
 * Validates an optional cliff-date ISO string relative to the end date.
 * Returns an error if the cliff is after the end date.
 */
function validateCliffDate(cliffValue: string, endValue: string): string {
  if (!cliffValue) return "";
  const cliffTs = new Date(cliffValue).getTime();
  if (isNaN(cliffTs)) return "Invalid cliff date.";
  if (cliffTs <= Date.now()) return "Cliff date must be in the future.";
  if (endValue) {
    const endTs = new Date(endValue).getTime();
    if (!isNaN(endTs) && cliffTs >= endTs) {
      return "Cliff date must be before the end date.";
    }
  }
  return "";
}

/**
 * Validates the scheduled start datetime-local string.
 * Must be provided and strictly in the future (> now).
 */
function validateScheduledStart(value: string): string {
  if (!value) return "Scheduled start date is required when scheduling is enabled.";
  const ts = new Date(value).getTime();
  if (isNaN(ts)) return "Invalid date.";
  if (ts <= Date.now()) return "Start time must be in the future.";
  return "";
}

const stepLabels: Record<Step, { title: string; number: number }> = {
  recipient: { title: "Recipient", number: 1 },
  amount: { title: "Amount & Duration", number: 2 },
  preview: { title: "Preview", number: 3 },
  review: { title: "Review & Confirm", number: 4 },
};

const STEPS: Step[] = ["recipient", "amount", "preview", "review"];

function NewStreamWizard() {
  const router = useRouter();
  const t = useTranslations("stream_new");
  const [activeTab, setActiveTab] = useState<PageTab>("single");
  const [step, setStep] = useState<Step>("recipient");
  const searchParams = useSearchParams();
  const { address, triggerStreamRefresh } = useWallet();
  const { defaultToken, defaultDuration, defaultCliffDuration } = usePreferences();
  const settings = useSettings();

  const recipientParam = searchParams.get("recipient");
  const amountParam = searchParams.get("amount");
  const durationParam = searchParams.get("duration");
  const tokenParam = searchParams.get("token");

  // ----- sessionStorage draft -----
  // Read once before any useState initialisation so we can use draft values
  // as initial state. URL query params take priority over the draft.
  const draft = readDraft();

  const initialRecipient = (() => {
    if (recipientParam && /^G[A-Z2-7]{55}$/.test(recipientParam)) return recipientParam;
    return draft?.recipient ?? "";
  })();
  const initialAmount = (() => {
    if (amountParam) {
      const num = parseFloat(amountParam);
      if (!isNaN(num) && num > 0) return amountParam;
    }
    return draft?.amount ?? "";
  })();
  const initialDuration = (() => {
    if (durationParam) {
      const num = parseFloat(durationParam);
      if (!isNaN(num) && num > 0) return Math.round(num);
    }
    return draft?.duration ?? 0;
  })();

  // Prefill the token when arriving from a "Clone stream" action. A token that
  // matches a supported symbol selects it directly; a contract address (or
  // other asset id) is routed through the custom-token field.
  const initialTokenIsCustom =
    !!tokenParam && /^C[A-Z2-7]{55}$/.test(tokenParam);
  const initialToken = (() => {
    if (tokenParam && SUPPORTED_TOKENS.some((t) => t.symbol === tokenParam)) {
      return tokenParam;
    }
    if (initialTokenIsCustom) return CUSTOM_TOKEN_VALUE;
    return undefined;
  })();

  const [recipient, setRecipient] = useState(initialRecipient);
  const [amount, setAmount] = useState(initialAmount);
  // Use URL param first, then saved preference, then 0
  const [duration, setDuration] = useState(initialDuration || defaultDuration || 0);
  // Pre-select token from preference when no URL param overrides
  const [selectedToken, setSelectedToken] = useState<string>(
    initialToken ??
      SUPPORTED_TOKENS.find((t) => t.symbol === defaultToken)?.symbol ??
      SUPPORTED_TOKENS[0].symbol,
  );
  const [customTokenAddress, setCustomTokenAddress] = useState(
    draft?.customTokenAddress ?? (initialTokenIsCustom ? (tokenParam ?? "") : ""),
  );
  const [customTokenError, setCustomTokenError] = useState("");
  const [loading, setLoading] = useState(false);
  useUnsavedChangesWarning((recipient.trim() !== "" || amount.trim() !== "") && !loading);
  const [errors, setErrors] = useState({ recipient: "", amount: "", duration: "", endDate: "", cliffDate: "", scheduledStart: "" });
  const [touched, setTouched] = useState({ recipient: false, amount: false });
  const [durationPickerKey, setDurationPickerKey] = useState(0);

  // Optional end date & cliff date (ISO datetime-local value)
  const [endDate, setEndDate] = useState(draft?.endDate ?? "");
  const [cliffDate, setCliffDate] = useState(draft?.cliffDate ?? "");

  // ----- persistence helpers -----
  const { saveDraft, clearDraft } = useFormPersist();

  /** Helper: persist the entire current form state after any field change. */
  function persist(overrides: Partial<{
    recipient: string;
    amount: string;
    duration: number;
    selectedToken: string;
    customTokenAddress: string;
    endDate: string;
    cliffDate: string;
    metadataUri: string;
  }> = {}) {
    saveDraft({
      recipient,
      amount,
      duration,
      selectedToken,
      customTokenAddress,
      endDate,
      cliffDate,
      metadataUri,
      ...overrides,
    });
  }

  // Scheduling
  const [schedulingEnabled, setSchedulingEnabled] = useState(false);
  const [scheduledStart, setScheduledStart] = useState("");

  // Re-validate scheduled start time when the form regains focus
  // (user may have left the tab open and the selected time became past)
  useEffect(() => {
    const handleFocus = () => {
      if (schedulingEnabled && scheduledStart) {
        setErrors((prev) => ({
          ...prev,
          scheduledStart: validateScheduledStart(scheduledStart),
        }));
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [schedulingEnabled, scheduledStart]);

  // Transaction progress
  const [txStage, setTxStage] = useState<TxStage | null>(null);
  const [txFailedStage, setTxFailedStage] = useState<TxStage | undefined>(undefined);
  const [txError, setTxError] = useState<string | undefined>(undefined);

  // Protocol fee state for review step
  const [feeBasisPoints, setFeeBasisPoints] = useState<number>(0);
  const [feeLoading, setFeeLoading] = useState(false);

  // Load protocol fee config whenever we enter the preview or review step (#430)
  useEffect(() => {
    if (step !== "review" && step !== "preview") return;
    let active = true;
    setFeeLoading(true);
    getFeeConfig()
      .then(({ basisPoints }) => {
        if (active) setFeeBasisPoints(basisPoints);
      })
      .catch(() => {
        if (active) setFeeBasisPoints(0);
      })
      .finally(() => {
        if (active) setFeeLoading(false);
      });
    return () => { active = false; };
  }, [step]);

  // Gas fee estimate
  const [gasFee, setGasFee] = useState<GasFeeEstimate | null>(null);
  const [gasFeeLoading, setGasFeeLoading] = useState(false);
  const [gasFeeStale, setGasFeeStale] = useState(false);
  const gasFeeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Also surface the Soroban network fee estimate on the review step so users
  // know the cost before signing, even if they skipped past the amount step
  // (e.g. when arriving from a clone action).
  useEffect(() => {
    if (step !== "review") return;
    const parsed = parseFloat(amount);
    if (!(parsed > 0)) return;
    let active = true;
    setGasFeeLoading(true);
    getGasFeeEstimate(Math.round(parsed * 10_000_000))
      .then((estimate) => {
        if (active) setGasFee(estimate);
      })
      .catch(() => {
        /* keep last known value; the panel degrades gracefully */
      })
      .finally(() => {
        if (active) setGasFeeLoading(false);
      });
    return () => {
      active = false;
    };
  }, [step, amount]);

  // Address verification state
  const [addressVerification, setAddressVerification] = useState<AddressVerification | null>(null);
  const [verificationAcknowledged, setVerificationAcknowledged] = useState(false);
  const [verificationLoading, setVerificationLoading] = useState(false);
  const verificationDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cancellation handle for the in-flight verification (#724): aborted when the
  // recipient changes or the component unmounts.
  const verificationAbortRef = useRef<AbortController | null>(null);

  // Sender's recipient whitelist / address book (#432)
  const senderKey = address ?? undefined;
  const [senderContacts, setSenderContacts] = useState<AddressBookContact[]>([]);
  const [whitelistEnforced, setWhitelistEnforcedState] = useState(false);
  const [savedToBook, setSavedToBook] = useState<string | null>(null); // last address quick-saved

  useEffect(() => {
    setSenderContacts(getContacts(senderKey));
    setWhitelistEnforcedState(isWhitelistEnforced(senderKey));
    setSavedToBook(null);
  }, [senderKey]);

  const recipientInBook =
    !!recipient &&
    /^G[A-Z2-7]{55}$/.test(recipient) &&
    senderContacts.some((c) => c.address.toLowerCase() === recipient.toLowerCase());

  /**
   * Whitelist rejection message for an arbitrary address (#432).
   *
   * Exposed as a function so the recipient field can re-run the check against
   * the value the user is currently typing, not just against the committed
   * `recipient` state — otherwise a stale whitelist message survives the user
   * correcting the address (#599).
   */
  function whitelistErrorFor(value: string): string {
    if (!value || !/^G[A-Z2-7]{55}$/.test(value)) return "";
    const inBook = senderContacts.some(
      (c) => c.address.toLowerCase() === value.toLowerCase(),
    );
    if (inBook) return "";
    return whitelistEnforced && !isRecipientApproved(value, senderKey)
      ? "Recipient is not in your approved list. Add them via the Address Book to continue."
      : "";
  }

  const recipientWhitelistError = whitelistErrorFor(recipient);

  function handleQuickSaveRecipient() {
    if (!recipient || !/^G[A-Z2-7]{55}$/.test(recipient)) return;
    if (!senderContacts.some((c) => c.address.toLowerCase() === recipient.toLowerCase())) {
      const ok = saveContact(
        {
          id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
          name: `${recipient.slice(0, 6)}…${recipient.slice(-4)}`,
          address: recipient,
        },
        senderKey,
      );
      if (ok) {
        setSenderContacts(getContacts(senderKey));
        setSavedToBook(recipient);
      }
    }
  }

  // Track the latest recipient so a verification for the previous address can
  // be recognised as stale when it resolves late (issue #723).
  const recipientRef = useRef(recipient);
  useEffect(() => {
    recipientRef.current = recipient;
  }, [recipient]);

  // Trigger address verification when recipient changes
  useEffect(() => {
    if (!recipient) {
      setAddressVerification(null);
      setVerificationAcknowledged(false);
      return;
    }

    if (verificationDebounceRef.current) {
      clearTimeout(verificationDebounceRef.current);
    }

    // Abort any in-flight verification for the previous recipient, and let the
    // effect cleanup abort this one on unmount or recipient change (#724).
    const controller = new AbortController();
    verificationAbortRef.current = controller;

    setVerificationLoading(true);
    verificationDebounceRef.current = setTimeout(async () => {
      try {
        const result = await verifyAddress(recipient, {
          signal: controller.signal,
          isCurrentTarget: () => recipientRef.current === recipient,
        });
        // Discard a late result for an address the user already left (#723):
        // the newer verification's result must win, never this one.
        if (recipientRef.current !== recipient || controller.signal.aborted) return;
        setAddressVerification(result);
      } catch {
        // Silently fail verification (don't block form) — but a stale/cancelled
        // run must not overwrite the newer target's state either.
        if (recipientRef.current !== recipient || controller.signal.aborted) return;
        setAddressVerification(null);
      } finally {
        // A stale run must not clear the newer run's loading state.
        if (recipientRef.current === recipient && !controller.signal.aborted) {
          setVerificationLoading(false);
        }
      }
    }, 800); // Debounce federation resolution

    return () => {
      if (verificationDebounceRef.current) {
        clearTimeout(verificationDebounceRef.current);
      }
      // Component unmounted (or recipient changed): cancel in-flight horizon
      // and federation lookups so nothing keeps running or caches afterwards
      // (issue #724).
      controller.abort();
    };
  }, [recipient]);

  // Auto-renewal settings
  const [autoRenew, setAutoRenew] = useState(false);
  const [autoRenewDuration, setAutoRenewDuration] = useState(0); // 0 = same as stream duration
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Fee-bump (fee sponsorship) toggle
  const feeSponsorAddress = getOptionalEnvVar("NEXT_PUBLIC_FEE_SPONSOR_ADDRESS");
  const [feeBumpEnabled, setFeeBumpEnabled] = useState(false);

  // Metadata URI setting
  const [metadataUri, setMetadataUri] = useState("");
  const [metadataUriError, setMetadataUriError] = useState("");

  // #408 — optional plaintext memo stored in the stream metadata URI
  const [memo, setMemo] = useState("");

  // Preview state
  const [previewLoading, setPreviewLoading] = useState(false);

  // Large-amount typed confirmation (#428)
  const streamThreshold = settings.streamThreshold;
  const requiresTypedConfirm = (parseFloat(amount) || 0) >= streamThreshold && streamThreshold > 0;
  const [confirmAmountInput, setConfirmAmountInput] = useState("");
  const confirmAmountMatches =
    !requiresTypedConfirm ||
    confirmAmountInput.trim() === String(parseFloat(amount));

  // Reset typed confirmation whenever the amount or step changes
  useEffect(() => {
    setConfirmAmountInput("");
  }, [amount, step]);



  // Debounced gas fee re-fetch whenever amount changes on the amount step
  useEffect(() => {
    if (step !== "amount") return;
    const parsed = parseFloat(amount);
    if (!amount || isNaN(parsed) || parsed <= 0) {
      setGasFee(null);
      return;
    }
    if (gasFeeDebounceRef.current) clearTimeout(gasFeeDebounceRef.current);
    gasFeeDebounceRef.current = setTimeout(async () => {
      setGasFeeLoading(true);
      setGasFeeStale(false);
      try {
        const estimate = await getGasFeeEstimate(Math.round(parsed * 10_000_000));
        setGasFee(estimate);
      } catch {
        setGasFeeStale(true); // keep last known value, mark stale
      } finally {
        setGasFeeLoading(false);
      }
    }, 500);
    return () => {
      if (gasFeeDebounceRef.current) clearTimeout(gasFeeDebounceRef.current);
    };
  }, [amount, step]);

  // Balance top-up state (issue #357)
  const [mockBalance, setMockBalance] = useState<number>(() => {
    if (typeof window !== "undefined" && typeof (window as unknown as Record<string, unknown>).__MOCK_WALLET_BALANCE__ === "number") {
      return (window as unknown as Record<string, unknown>).__MOCK_WALLET_BALANCE__ as number;
    }
    return 500; // 500 tokens default simulated balance
  });
  const [showTopUpBanner, setShowTopUpBanner] = useState(false);
  const [shortfall, setShortfall] = useState(0);
  const balancePollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Listen for external mock balance updates (for e2e/unit tests & top-up flow)
  useEffect(() => {
    function handleBalanceEvent(e: Event) {
      const customEvent = e as CustomEvent<number>;
      if (typeof customEvent.detail === "number") {
        setMockBalance(customEvent.detail);
      }
    }
    window.addEventListener("mock-balance-update", handleBalanceEvent);
    return () => window.removeEventListener("mock-balance-update", handleBalanceEvent);
  }, []);

  // Check balance when entering review step and whenever amount changes
  useEffect(() => {
    if (step !== "review") {
      setShowTopUpBanner(false);
      if (balancePollRef.current) clearInterval(balancePollRef.current);
      return;
    }
    const amountNum = parseFloat(amount) || 0;
    const currentBal = (typeof window !== "undefined" && typeof (window as unknown as Record<string, unknown>).__MOCK_WALLET_BALANCE__ === "number")
      ? ((window as unknown as Record<string, unknown>).__MOCK_WALLET_BALANCE__ as number)
      : mockBalance;
    const diff = amountNum - currentBal;
    if (diff > 0) {
      setShortfall(diff);
      setShowTopUpBanner(true);
      // Poll every 1s to check if balance became sufficient
      balancePollRef.current = setInterval(() => {
        const checkBal = (typeof window !== "undefined" && typeof (window as unknown as Record<string, unknown>).__MOCK_WALLET_BALANCE__ === "number")
          ? ((window as unknown as Record<string, unknown>).__MOCK_WALLET_BALANCE__ as number)
          : mockBalance;
        const stillShort = amountNum - checkBal;
        if (stillShort <= 0) {
          setShowTopUpBanner(false);
          setShortfall(0);
          if (balancePollRef.current) clearInterval(balancePollRef.current);
        } else {
          setShortfall(stillShort);
        }
      }, 1000);
    } else {
      setShowTopUpBanner(false);
      setShortfall(0);
    }
    return () => {
      if (balancePollRef.current) clearInterval(balancePollRef.current);
    };
  }, [step, amount, mockBalance]);

  // Collateral requirement
  const [collateralBps, setCollateralBps] = useState<number | null>(null);
  const [isNewSender, setIsNewSender] = useState(false);

  // Deposit cap validation (#526)
  const [depositCapStroops, setDepositCapStroops] = useState<number | null>(null);
  const [capLoading, setCapLoading] = useState(false);

  /**
   * Full validation for the amount field: the format rules plus the
   * contract's maximum deposit cap (#526).
   *
   * This is the single source of truth for the amount error, so
   * re-validating on every input change clears the message exactly when the
   * amount becomes acceptable (#599).
   */
  function validateAmountField(value: string): string {
    const formatError = validateAmount(value);
    if (formatError) return formatError;
    if (depositCapStroops !== null && depositCapStroops > 0) {
      const amountStroops = Math.round(parseFloat(value) * 10_000_000);
      if (amountStroops > depositCapStroops) {
        const capFormatted = (depositCapStroops / 10_000_000).toLocaleString();
        return `Amount exceeds the contract's maximum deposit cap of ${capFormatted} ${selectedToken}. Please enter a lower amount.`;
      }
    }
    return "";
  }

  // Fetch collateral config and new-sender status once when reaching review step
  useEffect(() => {
    if (step !== "review") return;
    let cancelled = false;
    async function fetchCollateral() {
      const [config, newSender] = await Promise.all([
        getCollateralConfig(),
        checkIsNewSender(address ?? ""),
      ]);
      if (!cancelled) {
        setCollateralBps(config.basisPoints);
        setIsNewSender(newSender);
      }
    }
    void fetchCollateral();
    return () => { cancelled = true; };
  }, [step, address]);

  // Fetch contract deposit cap once when the user reaches the amount step (#526).
  // The cap is validated again in goNext() before allowing the user to advance.
  useEffect(() => {
    if (step !== "amount") return;
    let cancelled = false;
    setCapLoading(true);
    getStreamCapConfig()
      .then(({ maxDepositStroops }) => {
        if (!cancelled) setDepositCapStroops(maxDepositStroops);
      })
      .catch(() => {
        // If the cap cannot be fetched, allow the user to proceed but clear
        // any stale error so they aren't permanently blocked.
        if (!cancelled) setDepositCapStroops(null);
      })
      .finally(() => {
        if (!cancelled) setCapLoading(false);
      });
    return () => { cancelled = true; };
  }, [step]);

  function handleTemplateSelect(seconds: number, suggestedAmount?: string, recipientOverride?: string, tokenOverride?: string, cliffDateOverride?: string) {
    setDuration(seconds);
    setErrors((prev) => ({ ...prev, duration: validateDuration(seconds) }));
    const newAmount = suggestedAmount ?? amount;
    const newRecipient =
      recipientOverride && /^G[A-Z2-7]{55}$/.test(recipientOverride)
        ? recipientOverride
        : recipient;
    if (suggestedAmount) {
      setAmount(suggestedAmount);
      setErrors((prev) => ({ ...prev, amount: validateAmountField(suggestedAmount) }));
    }
    if (recipientOverride && /^G[A-Z2-7]{55}$/.test(recipientOverride)) {
      setRecipient(recipientOverride);
      setErrors((prev) => ({ ...prev, recipient: validateRecipientField(recipientOverride) }));
    }
    if (tokenOverride && SUPPORTED_TOKENS.some((t) => t.symbol === tokenOverride)) {
      setSelectedToken(tokenOverride);
    }
    if (cliffDateOverride) {
      setCliffDate(cliffDateOverride);
      setErrors((prev) => ({ ...prev, cliffDate: validateCliffDate(cliffDateOverride, endDate) }));
    }
    persist({ duration: seconds, amount: newAmount, recipient: newRecipient });
  }

  /**
   * Full validation for the recipient field: address format plus the sender's
   * recipient whitelist (#432).
   *
   * Used both when submitting and when re-validating on input change so the
   * two never disagree about why a recipient is (or is not) acceptable.
   */
  function validateRecipientField(value: string): string {
    return validateRecipient(value) || whitelistErrorFor(value);
  }

  function handleRecipientBlur() {
    setTouched((prev) => ({ ...prev, recipient: true }));
    setErrors((prev) => ({ ...prev, recipient: validateRecipientField(recipient) }));
  }

  function handleAmountBlur() {
    setTouched((prev) => ({ ...prev, amount: true }));
    setErrors((prev) => ({ ...prev, amount: validateAmountField(amount) }));
  }

  /**
   * Re-validate a field after the user edits it (#599).
   *
   * Once a field has been touched (the user blurred it, or an error was
   * raised for it) the error message must track the current value: it is
   * cleared as soon as the value becomes valid, and refreshed when it stays
   * invalid. Fields the user has not interacted with yet keep whatever state
   * they had — no error is raised for them before the first blur.
   */
  function revalidate(
    field: "recipient" | "amount",
    value: string,
    validate: (v: string) => string,
  ) {
    setErrors((prev) => {
      // A field that has never been touched and has no message on screen is
      // left alone: no error is raised before the user has finished editing.
      if (!touched[field] && !prev[field]) return prev;
      return { ...prev, [field]: validate(value) };
    });
  }

  function goNext() {
    if (step === "recipient") {
      // Covers both the address format and whitelist enforcement (#432).
      const err = validateRecipientField(recipient);
      if (err) {
        setErrors((prev) => ({ ...prev, recipient: err }));
        setTouched((prev) => ({ ...prev, recipient: true }));
        return;
      }
      setStep("amount");
    } else if (step === "amount") {
      const aErr = validateAmountField(amount);
      const dErr = validateDuration(duration);
      const eErr = validateEndDate(endDate);
      const cErr = validateCliffDate(cliffDate, endDate);
      const sErr = schedulingEnabled ? validateScheduledStart(scheduledStart) : "";
      if (aErr || dErr || eErr || cErr || sErr) {
        // Mark the amount as touched so that correcting it re-validates and
        // clears the message instead of leaving it on screen (#599).
        setTouched((prev) => ({ ...prev, amount: true }));
        setErrors((prev) => ({
          ...prev,
          amount: aErr,
          duration: dErr,
          endDate: eErr,
          cliffDate: cErr,
          scheduledStart: sErr,
        }));
        return;
      }
      setStep("preview");
    }
  }

  function goBack() {
    const idx = STEPS.indexOf(step);
    if (idx > 0) setStep(STEPS[idx - 1]);
  }

  function goConfirmPreview() {
    // From preview step, go to review step
    setStep("review");
  }

  // ---- Preview calculation helpers ----
  function calculateFlowRatePerDay(durationSeconds: number, amountUSDC: number): number {
    if (!durationSeconds || durationSeconds <= 0) return 0;
    const secondsPerDay = 86400;
    return (amountUSDC * secondsPerDay) / durationSeconds;
  }

  function calculateEndDate(durationSeconds: number): Date {
    return new Date(Date.now() + durationSeconds * 1000);
  }

  function formatFlowRate(flowRatePerDay: number): string {
    return flowRatePerDay.toFixed(7).replace(/\.?0+$/, "") || "0";
  }

  function resolvedTokenAddress(): string | null {
    if (selectedToken === CUSTOM_TOKEN_VALUE) {
      const trimmed = customTokenAddress.trim();
      if (!trimmed) { setCustomTokenError("Contract address is required."); return null; }
      setCustomTokenError("");
      return trimmed;
    }
    return SUPPORTED_TOKENS.find((t) => t.symbol === selectedToken)?.address ?? SUPPORTED_TOKENS[0].address;
  }

  // Undo window before broadcasting (#650): the user can cancel an accidental
  // submit within UNDO_WINDOW_SECONDS without losing any entered data.
  const UNDO_WINDOW_SECONDS = 5;
  const [undoCountdown, setUndoCountdown] = useState<number | null>(null);
  const undoResolveRef = useRef<((proceed: boolean) => void) | null>(null);

  function waitForUndoWindow(): Promise<boolean> {
    return new Promise((resolve) => {
      let remaining = UNDO_WINDOW_SECONDS;
      setUndoCountdown(remaining);
      const interval = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) finish(true);
        else setUndoCountdown(remaining);
      }, 1000);
      function finish(proceed: boolean) {
        clearInterval(interval);
        undoResolveRef.current = null;
        setUndoCountdown(null);
        resolve(proceed);
      }
      undoResolveRef.current = finish;
    });
  }

  function handleUndoSubmit() {
    undoResolveRef.current?.(false);
  }

  async function handleCreateStream() {
    if (undoCountdown !== null) return;
    const rErr = validateRecipientField(recipient);
    const aErr = validateAmountField(amount);
    const dErr = validateDuration(duration);
    const eErr = validateEndDate(endDate);
    const cErr = validateCliffDate(cliffDate, endDate);
    const sErr = schedulingEnabled ? validateScheduledStart(scheduledStart) : "";
    const mErr = validateMetadataUri(metadataUri);
    if (rErr || aErr || dErr || eErr || cErr || sErr || mErr) {
      // Mark the amount as touched so correcting it re-validates and clears
      // the message rather than leaving it on screen (#599).
      setTouched((prev) => ({ ...prev, amount: true }));
      setErrors((prev) => ({
        ...prev,
        recipient: rErr,
        amount: aErr,
        duration: dErr,
        endDate: eErr,
        cliffDate: cErr,
        scheduledStart: sErr,
      }));
      setMetadataUriError(mErr);
      return;
    }

    // Large-amount guard (#428): never sign unless the typed confirmation matches
    if (!confirmAmountMatches) return;

    // Whitelist guard (#432): never sign to an unapproved recipient
    if (recipientWhitelistError) {
      setErrors((prev) => ({ ...prev, recipient: recipientWhitelistError }));
      return;
    }

    const tokenAddress = resolvedTokenAddress();
    if (!tokenAddress) return;

    // Convert scheduled start datetime-local → Unix timestamp (seconds)
    const scheduledStartTime =
      schedulingEnabled && scheduledStart
        ? Math.floor(new Date(scheduledStart).getTime() / 1000)
        : undefined;

    const proceed = await waitForUndoWindow();
    if (!proceed) return;

    setLoading(true);
    setTxStage(TxStage.Building);
    setTxFailedStage(undefined);
    setTxError(undefined);
    trackEvent({ type: "stream_create_start" });

    try {
      // Building phase — construct the tx envelope
      await new Promise((r) => setTimeout(r, 400));
      setTxStage(TxStage.Signing);

      // Signing phase — wait for wallet
      await new Promise((r) => setTimeout(r, 400));
      setTxStage(TxStage.Submitting);

      // Submitting phase — broadcast
      await new Promise((r) => setTimeout(r, 300));
      setTxStage(TxStage.Confirming);

      // Confirming phase — actual SDK call
      const result = await sorostream.createStream({
        recipient,
        amount,
        durationSeconds: duration,
        token: selectedToken === CUSTOM_TOKEN_VALUE ? tokenAddress : selectedToken,
        autoRenew,
        autoRenewDurationSeconds: autoRenew && autoRenewDuration > 0 ? autoRenewDuration : undefined,
        scheduledStartTime,
        metadataUri: metadataUri || undefined,
        memo: memo.trim() || undefined,
        feeBump: feeBumpEnabled && !!feeSponsorAddress,
        feeSponsorAddress: feeBumpEnabled && feeSponsorAddress ? feeSponsorAddress : undefined,
      });

      // Clear the persisted draft the moment the stream is confirmed on-chain,
      // so nothing that runs during the success screen (or after navigation)
      // can leave the just-submitted form data behind for the next visit (#721).
      clearDraft();

      setTxStage(TxStage.Done);
      trackEvent({ type: "stream_create_complete", streamId: result.streamId });

      // Auto-close after 2 seconds, then redirect
      await new Promise((r) => setTimeout(r, 2000));

      setRecipient("");
      setAmount("");
      setDuration(0);
      setEndDate("");
      setCliffDate("");
      setAutoRenew(false);
      setAutoRenewDuration(0);
      setShowAdvanced(false);
      setMetadataUri("");
      setMemo("");
      setMetadataUriError("");
      setGasFee(null);
      setFeeBumpEnabled(false);
      setErrors({ recipient: "", amount: "", duration: "", endDate: "", cliffDate: "", scheduledStart: "" });
      setSchedulingEnabled(false);
      setScheduledStart("");
      setTouched({ recipient: false, amount: false });
      setDurationPickerKey((k) => k + 1);
      setConfirmAmountInput("");
      setStep("recipient");
      setTxStage(null);

      // Trigger stream list refresh so the new stream appears on the dashboard
      triggerStreamRefresh();

      router.push(`/stream/${result.streamId}?new=true`);
    } catch (err) {
      console.error("Failed to create stream:", err);
      setTxFailedStage(txStage ?? TxStage.Confirming);
      setTxError(err instanceof Error ? err.message : "Transaction failed. Please try again.");
      setTxStage(txStage ?? TxStage.Confirming);
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <main id="main-content" tabIndex={-1} className="min-h-screen bg-gray-900 text-white p-8">
        <div className="max-w-lg mx-auto">
          <h1 className="text-2xl font-bold mb-8">{t("title")}</h1>
          {txStage !== null ? (
            <div className="bg-gray-800 rounded-xl p-8 space-y-6" aria-label="Transaction in progress">
              <h2 className="text-lg font-semibold text-center">
                {txStage === TxStage.Done ? "🎉 Stream Created!" : "Creating your stream…"}
              </h2>
              <TransactionStepper
                currentStage={txStage}
                failedStage={txFailedStage}
                errorMessage={txError}
              />
              {txFailedStage && (
                <button
                  type="button"
                  onClick={() => { setLoading(false); setTxStage(null); setTxFailedStage(undefined); setTxError(undefined); clearDraft(); }}
                  className="w-full border border-gray-600 text-gray-300 py-3 rounded-lg font-medium hover:bg-gray-700 transition-colors"
                >
                  Back to Form
                </button>
              )}
            </div>
          ) : (
            <SkeletonForm />
          )}
        </div>
      </main>
    );
  }

  const canGoNext = step === "recipient"
    ? recipient.length > 0 && canCreateStream(addressVerification) && verificationAcknowledged === (addressVerification?.status === "unverified") && !recipientWhitelistError
    : step === "amount"
    ? amount.length > 0 && duration > 0
    : true;

  return (
    <main id="main-content" tabIndex={-1} className="min-h-screen bg-gray-900 text-white p-4 sm:p-8 pb-24 md:pb-8">
      <div className="max-w-lg mx-auto">
        {undoCountdown !== null && (
          <div
            role="status"
            aria-live="polite"
            data-testid="undo-submit-banner"
            className="mb-6 flex items-center justify-between gap-3 rounded-lg border border-yellow-600 bg-yellow-900/30 px-4 py-3 text-sm text-yellow-100"
          >
            <span>Submitting stream in {undoCountdown}s…</span>
            <button
              type="button"
              onClick={handleUndoSubmit}
              data-testid="undo-submit-button"
              className="rounded-md bg-yellow-600 px-3 py-1 font-medium text-gray-900 hover:bg-yellow-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
            >
              Undo
            </button>
          </div>
        )}
        {/* Tab switcher */}
        <div className="flex rounded-xl bg-gray-800 p-1 mb-8" role="tablist" aria-label="Create stream mode">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "single"}
            onClick={() => setActiveTab("single")}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${
              activeTab === "single"
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Single Stream
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "batch"}
            onClick={() => setActiveTab("batch")}
            className={`flex-1 py-2 text-sm font-medium rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 ${
              activeTab === "batch"
                ? "bg-gray-700 text-white"
                : "text-gray-400 hover:text-white"
            }`}
          >
            Batch Create
          </button>
        </div>

        {/* Batch tab */}
        {activeTab === "batch" && (
          <div role="tabpanel" aria-label="Batch create">
            <BatchCreateTab />
          </div>
        )}

        {/* Single stream tab */}
        {activeTab === "single" && (
        <div role="tabpanel" aria-label="Single stream">
        <div className="mb-8">
          <div className="flex items-center justify-center gap-2 mb-6">
            {STEPS.map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold transition-colors ${
                    step === s
                      ? "bg-green-700 text-white"
                      : STEPS.indexOf(step) > i
                      ? "bg-green-800 text-green-300"
                      : "bg-gray-700 text-gray-400"
                  }`}
                >
                  {STEPS.indexOf(step) > i ? "✓" : i + 1}
                </div>
                <span className={`text-xs hidden sm:inline ${step === s ? "text-white" : "text-gray-400"}`}>
                  {stepLabels[s].title}
                </span>
                {i < STEPS.length - 1 && (
                  <div className={`w-8 h-px ${STEPS.indexOf(step) > i ? "bg-green-600" : "bg-gray-700"}`} />
                )}
              </div>
            ))}
          </div>
          <h1 className="text-xl sm:text-2xl font-bold text-center">{stepLabels[step].title}</h1>
        </div>

        {/* Step: Recipient */}
        {step === "recipient" && (
          <div className="space-y-6">
            <div>
              <label htmlFor="recipient" className="text-gray-200 text-sm font-medium block mb-2">
                {t("recipient_label")}
              </label>
              <RecipientAutocomplete
                value={recipient}
                onChange={(v) => {
                  setRecipient(v);
                  // Re-validate on every keystroke so the message is cleared
                  // as soon as the address becomes valid, and stays accurate
                  // while it is still invalid (#599).
                  revalidate("recipient", v, validateRecipientField);
                  persist({ recipient: v });
                }}
                onBlur={handleRecipientBlur}
                placeholder={t("recipient_placeholder")}
                error={errors.recipient}
                touched={touched.recipient}
                senderAddress={senderKey}
              />
              {errors.recipient && (
                <p id="recipient-error" role="alert" className="text-red-400 text-sm mt-1">
                  {errors.recipient}
                </p>
              )}

              {/* Address book status (#432) */}
              {/* Keyed off the address format rather than `errors.recipient`:
                  when the whitelist rejects the recipient, the "Save to
                  address book" action is exactly what resolves the error, so
                  it must stay reachable (#599). */}
              {recipient && /^G[A-Z2-7]{55}$/.test(recipient) && (
                <div className="mt-2 flex items-center gap-2 text-xs">
                  {recipientInBook || savedToBook === recipient ? (
                    <span className="text-green-400" data-testid="recipient-in-book">
                      ✓ In your address book
                    </span>
                  ) : savedToBook !== recipient ? (
                    <>
                      <span className="text-gray-500">Not in your address book.</span>
                      <button
                        type="button"
                        onClick={handleQuickSaveRecipient}
                        className="text-green-400 hover:text-green-300 underline underline-offset-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded"
                        data-testid="quick-save-recipient"
                      >
                        Save to address book
                      </button>
                    </>
                  ) : null}
                  {whitelistEnforced && (
                    <span className="ml-auto text-gray-500">Whitelist mode on</span>
                  )}
                </div>
              )}

              {recipient && !errors.recipient && (
                <div className="mt-3 flex items-center gap-2">
                  {verificationLoading ? (
                    <AddressVerificationBadge status="pending" />
                  ) : addressVerification ? (
                    <AddressVerificationBadge
                      status={addressVerification.status}
                      federationName={addressVerification.federationName}
                    />
                  ) : null}
                </div>
              )}

              {addressVerification && (
                <AddressVerificationWarning
                  verification={addressVerification}
                  onAcknowledge={() => setVerificationAcknowledged(true)}
                  acknowledged={verificationAcknowledged}
                />
              )}
            </div>
          </div>
        )}

        {/* Step: Amount & Duration */}
        {step === "amount" && (
          <div className="space-y-6">
            {/* Token selector */}
            <div>
              <label htmlFor="token-select" className="text-gray-200 text-sm font-medium block mb-2">
                Token
              </label>
              <select
                id="token-select"
                value={selectedToken}
                onChange={(e) => {
                  setSelectedToken(e.target.value);
                  setCustomTokenError("");
                  persist({ selectedToken: e.target.value });
                }}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
              >
                {SUPPORTED_TOKENS.map((t) => (
                  <option key={t.symbol} value={t.symbol}>
                    {t.symbol} — {t.name} ({t.address === "native" ? "native" : `${t.address.slice(0, 6)}…${t.address.slice(-4)}`})
                  </option>
                ))}
                <option value={CUSTOM_TOKEN_VALUE}>Custom token…</option>
              </select>
              {selectedToken === CUSTOM_TOKEN_VALUE && (
                <div className="mt-2">
                  <input
                    id="custom-token-address"
                    type="text"
                    value={customTokenAddress}
                    onChange={(e) => { setCustomTokenAddress(e.target.value); setCustomTokenError(""); persist({ customTokenAddress: e.target.value }); }}
                    placeholder="Contract address (e.g. C…)"
                    className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white text-sm font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                    aria-label="Custom token contract address"
                    aria-invalid={!!customTokenError}
                    aria-describedby={customTokenError ? "custom-token-error" : undefined}
                  />
                  {customTokenError && (
                    <p id="custom-token-error" className="text-red-400 text-xs mt-1">{customTokenError}</p>
                  )}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label htmlFor="amount" className="text-gray-200 text-sm font-medium">
                  {t("amount_label")}
                </label>
                {depositCapStroops !== null && depositCapStroops > 0 && (
                  <span className="text-gray-400 text-xs">
                    Max: {(depositCapStroops / 10_000_000).toLocaleString()} {selectedToken === CUSTOM_TOKEN_VALUE ? "tokens" : selectedToken}
                  </span>
                )}
                {capLoading && (
                  <span className="text-gray-500 text-xs">Checking limit…</span>
                )}
              </div>
              <input
                id="amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  let val = e.target.value;
                  // Prevent negative numbers by removing any minus signs
                  val = val.replace(/^-/, "");
                  setAmount(val);
                  // Re-validate on every keystroke so the error is cleared as
                  // soon as the amount is valid (#599).
                  revalidate("amount", val, validateAmountField);
                  persist({ amount: val });
                }}
                onPaste={(e) => {
                  let pasted = e.clipboardData.getData("text");
                  // Remove minus signs from pasted content
                  pasted = pasted.replace(/-/g, "");
                  // Strip non-numeric characters, keeping digits and at most one decimal point
                  let cleaned = pasted.replace(/[^0-9.]/g, "");
                  const dotIndex = cleaned.indexOf(".");
                  if (dotIndex !== -1) {
                    cleaned = cleaned.slice(0, dotIndex + 1) + cleaned.slice(dotIndex + 1).replace(/\./g, "");
                  }
                  if (cleaned !== pasted && cleaned !== (e.target as HTMLInputElement).value) {
                    e.preventDefault();
                    setAmount(cleaned);
                    // Pasting is an edit like any other: re-validate so a
                    // pasted value clears a stale error (#599).
                    revalidate("amount", cleaned, validateAmountField);
                    persist({ amount: cleaned });
                  }
                }}
                onBlur={handleAmountBlur}
                placeholder={t("amount_placeholder")}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                aria-required="true"
                aria-invalid={!!errors.amount}
                aria-describedby={errors.amount ? "amount-error" : undefined}
              />
              {errors.amount && (
                <p id="amount-error" role="alert" className="text-red-400 text-sm mt-1">
                  {errors.amount}
                </p>
              )}

              {!errors.amount && amount && (
                <NetReceivedDisplay
                  amount={amount}
                  tokenSymbol={
                    selectedToken === CUSTOM_TOKEN_VALUE ? "Custom" : selectedToken
                  }
                  isCustomToken={selectedToken === CUSTOM_TOKEN_VALUE}
                />
              )}

              {!errors.amount && amount && selectedToken !== CUSTOM_TOKEN_VALUE && (
                <AssetConversionPreview
                  amount={amount}
                  tokenSymbol={selectedToken}
                />
              )}
            </div>

            <StreamTemplatePicker
              onSelect={handleTemplateSelect}
              currentRecipient={recipient}
              currentAmount={amount}
              currentDuration={duration}
              currentToken={selectedToken !== CUSTOM_TOKEN_VALUE ? selectedToken : undefined}
              currentCliffDate={cliffDate}
            />

            <div>
              {/* Not a real form label — DurationPicker renders three separate
                  inputs (days/hours/minutes) with their own group label, so a
                  <label> here can't point at a single control via htmlFor. */}
              <div className="text-gray-200 text-sm font-medium block mb-2">{t("duration_label")}</div>
              <DurationPicker
                key={durationPickerKey}
                initialSeconds={duration > 0 ? duration : undefined}
                onChange={(s) => {
                  setDuration(s);
                  // Re-validate on every change so the error tracks the
                  // current duration instead of going stale (#599).
                  setErrors((prev) => ({ ...prev, duration: validateDuration(s) }));
                  persist({ duration: s });
                }}
                error={errors.duration || undefined}
              />
            </div>

            {/* Stream Rate Calculator (#472) */}
            {amount && duration > 0 && (
              <StreamRateCalculator
                amount={amount}
                duration={duration}
              />
            )}

            {/* Scheduling toggle */}
            <SchedulingToggle
              enabled={schedulingEnabled}
              onToggle={(v) => {
                setSchedulingEnabled(v);
                if (!v) {
                  setScheduledStart("");
                  setErrors((prev) => ({ ...prev, scheduledStart: "" }));
                }
              }}
              value={scheduledStart}
              onChange={(v) => {
                setScheduledStart(v);
                setErrors((prev) => ({ ...prev, scheduledStart: validateScheduledStart(v) }));
              }}
              onBlur={() =>
                setErrors((prev) => ({
                  ...prev,
                  scheduledStart: schedulingEnabled ? validateScheduledStart(scheduledStart) : "",
                }))
              }
              error={errors.scheduledStart || undefined}
            />

            {/* Optional end date (#427) — timezone-aware alternative input
                to the duration picker. Picking an instant resolves the
                equivalent duration and keeps the absolute UTC value in state. */}
            <EndDatePicker
              id="end-date"
              value={endDate}
              onChange={(isoUtc) => {
                setEndDate(isoUtc);
                setErrors((prev) => ({ ...prev, endDate: validateEndDate(isoUtc) }));
                persist({ endDate: isoUtc });
              }}
              onDurationResolved={(seconds) => {
                if (seconds > 0) {
                  setDuration(seconds);
                  setErrors((prev) => ({ ...prev, duration: "" }));
                  persist({ duration: seconds });
                }
              }}
              error={errors.endDate || undefined}
            />

            {/* Optional cliff date */}
            <div>
              <label htmlFor="cliff-date" className="text-gray-200 text-sm font-medium block mb-2">
                Cliff Date <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                id="cliff-date"
                type="datetime-local"
                onFocus={primePickerToNow}
                value={cliffDate}
                onChange={(e) => {
                  setCliffDate(e.target.value);
                  setErrors((prev) => ({ ...prev, cliffDate: validateCliffDate(e.target.value, endDate) }));
                  persist({ cliffDate: e.target.value });
                }}
                onBlur={() => setErrors((prev) => ({ ...prev, cliffDate: validateCliffDate(cliffDate, endDate) }))}
                className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                aria-invalid={!!errors.cliffDate}
                aria-describedby={errors.cliffDate ? "cliff-date-error" : undefined}
              />
              {errors.cliffDate && (
                <p id="cliff-date-error" role="alert" className="text-red-400 text-sm mt-1">
                  {errors.cliffDate}
                </p>
              )}
            </div>

            {amount && duration > 0 && (
              <VestingPreviewChart
                amount={amount}
                durationSeconds={duration}
                cliffSeconds={cliffDate ? Math.max(0, Math.floor((new Date(cliffDate).getTime() - Date.now()) / 1000)) : undefined}
                token={selectedToken === CUSTOM_TOKEN_VALUE ? "tokens" : selectedToken}
              />
            )}

            {amount && duration > 0 && (
              <FlowRatePreview amount={amount} durationSeconds={duration} />
            )}

            {amount && duration > 0 && (
              <StreamCostCalculator
                amount={amount}
                durationSeconds={duration}
                tokenSymbol={selectedToken === CUSTOM_TOKEN_VALUE ? "tokens" : selectedToken}
              />
            )}

            {/* Gas fee estimate */}
            {(gasFee || gasFeeLoading) && (
              <div
                className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg border ${
                  gasFeeStale
                    ? "bg-yellow-900/20 border-yellow-700/40 text-yellow-300"
                    : "bg-gray-800 border-gray-700 text-gray-400"
                }`}
                aria-live="polite"
                aria-label="Estimated network fee"
              >
                <span>Estimated network fee</span>
                <span className="flex items-center gap-1.5 font-mono">
                  {gasFeeLoading ? (
                    <>
                      <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                      </svg>
                      <span className="text-gray-500">Refreshing…</span>
                    </>
                  ) : (
                    <>
                      {gasFee && <span className={gasFeeStale ? "text-yellow-300" : "text-white"}>{gasFee.feeFormatted} XLM</span>}
                      {gasFeeStale && <span className="text-yellow-400" title="Could not refresh — showing last known estimate">⚠ stale</span>}
                    </>
                  )}
                </span>
              </div>
            )}

            {/* Advanced settings */}
            <div>
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                aria-expanded={showAdvanced}
                className="flex items-center gap-2 text-sm text-gray-400 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 rounded"
              >
                <svg
                  className={`h-4 w-4 transition-transform ${showAdvanced ? "rotate-90" : ""}`}
                  xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="9 18 15 12 9 6" />
                </svg>
                Advanced settings
              </button>

              {showAdvanced && (
                <div className="mt-4 space-y-4 pl-1">
                  {/* Auto-renewal toggle */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <label htmlFor="auto-renew-toggle" className="text-sm text-gray-200 font-medium">
                          Auto-Renewal
                        </label>
                        {/* Tooltip */}
                        <Tooltip label="How does auto-renewal work?">
                            When enabled, the stream automatically restarts at expiry using
                            the same amount. The renewal re-locks the same deposit from your
                            balance — ensure you have sufficient funds each cycle.
                            You can cancel auto-renewal at any time before the next cycle starts.
                          </Tooltip>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        Automatically restart the stream when it expires
                      </p>
                    </div>
                    <button
                      id="auto-renew-toggle"
                      type="button"
                      role="switch"
                      aria-checked={autoRenew}
                      onClick={() => setAutoRenew((v) => !v)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 flex-shrink-0 ${
                        autoRenew ? "bg-green-600" : "bg-gray-600"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          autoRenew ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Auto-renew duration (only when toggle is on) */}
                  {autoRenew && (
                    <div>
                      {/* Not a real form label — see the duration-picker note above. */}
                      <div className="text-sm text-gray-200 font-medium block mb-2">
                        Auto-Renew Duration{" "}
                        <span className="text-gray-400 font-normal">(optional — defaults to stream duration)</span>
                      </div>
                      <DurationPicker
                        initialSeconds={autoRenewDuration > 0 ? autoRenewDuration : undefined}
                        onChange={setAutoRenewDuration}
                      />
                    </div>
                  )}

                  {/* #408 — Memo / note field */}
                  <div>
                    <label htmlFor="stream-memo" className="text-sm text-gray-200 font-medium block mb-2">
                      Memo <span className="text-gray-400 font-normal">(optional)</span>
                    </label>
                    <input
                      id="stream-memo"
                      type="text"
                      value={memo}
                      onChange={(e) => setMemo(e.target.value)}
                      maxLength={100}
                      placeholder="e.g. Rent for March"
                      className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                    />
                    <p className="text-gray-500 text-xs mt-1">
                      Short plaintext note attached to the stream metadata. {memo.length}/100
                    </p>
                  </div>

                  {/* Metadata URI field */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <label htmlFor="metadata-uri" className="text-sm text-gray-200 font-medium">
                        Metadata URI <span className="text-gray-400 font-normal">(optional)</span>
                      </label>
                      {/* Tooltip */}
                      <Tooltip label="What is a metadata URI?">
                          A URI pointing to metadata about this stream (JSON, terms, documentation, etc.).
                          Supports ipfs://, https://, and ar:// schemes.
                        </Tooltip>
                    </div>
                    <input
                      id="metadata-uri"
                      type="text"
                      value={metadataUri}
                      onChange={(e) => {
                        const val = e.target.value;
                        setMetadataUri(val);
                        setMetadataUriError(validateMetadataUri(val));
                        persist({ metadataUri: val });
                      }}
                      onBlur={() => {
                        setMetadataUriError(validateMetadataUri(metadataUri));
                      }}
                      placeholder="e.g. ipfs://Qm... or https://example.com/metadata.json"
                      className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                      aria-invalid={!!metadataUriError}
                      aria-describedby={metadataUriError ? "metadata-uri-error" : undefined}
                    />
                    {metadataUriError && (
                      <p id="metadata-uri-error" className="text-red-400 text-sm mt-1">
                        {metadataUriError}
                      </p>
                    )}
                  </div>

                  {/* Fee Sponsorship toggle */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <label htmlFor="fee-bump-toggle" className="text-sm text-gray-200 font-medium">
                          Fee Sponsorship
                        </label>
                        <Tooltip label="What is fee sponsorship?">
                            When enabled, a third-party fee sponsor pays the transaction fee
                            instead of your wallet. Requires configuring NEXT_PUBLIC_FEE_SPONSOR_ADDRESS.
                            Falls back to user-paid fees if the sponsor is unavailable.
                          </Tooltip>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {feeSponsorAddress
                          ? "Gas fee will be paid by the sponsor account"
                          : "No fee sponsor configured — set NEXT_PUBLIC_FEE_SPONSOR_ADDRESS to enable"}
                      </p>
                    </div>
                    <button
                      id="fee-bump-toggle"
                      type="button"
                      role="switch"
                      aria-checked={feeBumpEnabled && !!feeSponsorAddress}
                      disabled={!feeSponsorAddress}
                      onClick={() => setFeeBumpEnabled((v) => !v)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
                        feeBumpEnabled && feeSponsorAddress ? "bg-blue-600" : "bg-gray-600"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          feeBumpEnabled && feeSponsorAddress ? "translate-x-6" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step: Preview */}
        {step === "preview" && (
          <div className="space-y-6">
            {/* Dry-run simulation (#430) — runs before the user can confirm */}
            <StreamDryRunPreview
              active={step === "preview"}
              amount={amount}
              durationSeconds={duration}
              cliffSeconds={cliffDate ? Math.max(0, Math.floor((new Date(cliffDate).getTime() - Date.now()) / 1000)) : undefined}
              feeBasisPoints={feeBasisPoints}
              token={selectedToken === CUSTOM_TOKEN_VALUE ? "tokens" : selectedToken}
            />

            <div className="bg-gray-800 rounded-xl p-6 space-y-4 border border-gray-700">
              <p className="text-gray-400 text-sm mb-4">Here&apos;s what your stream will look like on-chain:</p>

              {/* Flow rate per day */}
              <div>
                <span className="text-gray-400 text-sm">Flow rate per day</span>
                <div className="text-2xl font-bold text-green-400 mt-1 font-mono">
                  {formatFlowRate(calculateFlowRatePerDay(duration, parseFloat(amount) || 0))} {selectedToken === CUSTOM_TOKEN_VALUE ? "tokens" : selectedToken}/day
                </div>
              </div>

              {/* Total amount */}
              <div className="border-t border-gray-700 pt-4">
                <span className="text-gray-400 text-sm">Total amount</span>
                <div className="text-lg font-semibold text-white mt-1">
                  {amount} {selectedToken === CUSTOM_TOKEN_VALUE ? "tokens" : selectedToken}
                </div>
              </div>

              {/* Stream end date */}
              <div className="border-t border-gray-700 pt-4">
                <span className="text-gray-400 text-sm">Stream ends</span>
                <div className="text-lg font-semibold text-white mt-1">
                  {formatLocaleDateTime(calculateEndDate(duration), undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>

              {/* Protocol fee estimate */}
              <div className="border-t border-gray-700 pt-4">
                <span className="text-gray-400 text-sm">Estimated protocol fee</span>
                <div className="text-lg font-semibold text-yellow-400 mt-1">
                  {feeLoading ? (
                    <span className="text-gray-400 text-sm">Loading...</span>
                  ) : (
                    (() => {
                      const amountNum = parseFloat(amount) || 0;
                      const amountStroops = Math.round(amountNum * 10_000_000);
                      const { fee } = calcWithdrawBreakdown(amountStroops, feeBasisPoints);
                      const feeDisplay = (fee / 10_000_000).toFixed(7).replace(/\.?0+$/, "") || "0";
                      const tokenLabel = selectedToken === CUSTOM_TOKEN_VALUE ? "tokens" : selectedToken;
                      return `${feeDisplay} ${tokenLabel}`;
                    })()
                  )}
                </div>
              </div>

              {/* Recipient and sender summary */}
              <div className="border-t border-gray-700 pt-4 space-y-3">
                <div className="flex justify-between items-start text-sm">
                  <span className="text-gray-400">To</span>
                  <span className="text-white font-mono text-xs text-right max-w-[60%] break-all">{recipient}</span>
                </div>
                <div className="flex justify-between items-start text-sm">
                  <span className="text-gray-400">From</span>
                  <span className="text-white font-mono text-xs text-right max-w-[60%] break-all">{address ?? "—"}</span>
                </div>
              </div>
            </div>

            {/* Info box */}
            <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-4">
              <p className="text-blue-300 text-sm">
                Review the details above. Click &quot;Confirm&quot; to proceed to sign this transaction with your wallet, or &quot;Back&quot; to edit the stream parameters.
              </p>
            </div>
          </div>
        )}

        {/* Step: Review & Confirm */}
        {step === "review" && (
          <div className="space-y-6">
            {/* Balance top-up banner (#357) */}
            {showTopUpBanner && (
              <div
                role="alert"
                data-testid="top-up-banner"
                className="bg-orange-900/30 border border-orange-700/60 rounded-xl p-4 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-orange-400 text-base" aria-hidden="true">⚠</span>
                  <p className="text-orange-300 text-sm font-semibold">Insufficient Balance</p>
                </div>
                <p className="text-gray-300 text-sm">
                  Your wallet balance is too low for this stream. You need{" "}
                  <span className="font-mono font-semibold text-orange-300" data-testid="shortfall-amount">
                    {shortfall.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 7 })}{" "}
                    {selectedToken === CUSTOM_TOKEN_VALUE ? "tokens" : selectedToken}
                  </span>{" "}
                  more to proceed.
                </p>
                <a
                  href="https://stellarx.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm text-orange-400 hover:text-orange-300 underline underline-offset-2 transition-colors"
                >
                  Fund via Stellar DEX
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                  </svg>
                </a>
                <p className="text-gray-500 text-xs">This banner will auto-dismiss when your balance is sufficient.</p>
              </div>
            )}
            <div className="bg-gray-800 rounded-xl p-5 space-y-4 border border-gray-700">
              {/* Sender */}
              <div className="flex justify-between items-start">
                <span className="text-gray-400 text-sm">Sender</span>
                <span className="text-white font-mono text-xs text-right max-w-[60%] break-all">
                  {address ?? "—"}
                </span>
              </div>

              {/* Recipient */}
              <div className="flex justify-between items-start">
                <span className="text-gray-400 text-sm">Recipient</span>
                <span className="text-white font-mono text-xs text-right max-w-[60%] break-all">
                  {recipient}
                </span>
              </div>

              {/* Token */}
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">Token</span>
                <span className="text-white font-mono text-sm">
                  {selectedToken === CUSTOM_TOKEN_VALUE
                    ? `Custom (${customTokenAddress.slice(0, 8)}…)`
                    : selectedToken}
                </span>
              </div>

              {/* Total amount */}
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">Total amount</span>
                <span className="text-white font-mono text-sm">
                  {amount} {selectedToken === CUSTOM_TOKEN_VALUE ? "tokens" : selectedToken}
                </span>
              </div>

              {/* Duration */}
              <div className="flex justify-between items-center">
                <span className="text-gray-400 text-sm">Duration</span>
                <span className="text-white font-mono text-sm">
                  {(() => {
                    if (duration >= 86400) {
                      const totalDays = duration / 86400;
                      const isWhole = totalDays === Math.floor(totalDays);
                      const dayPart = isWhole ? `${Math.floor(totalDays)}d` : `${totalDays.toFixed(1)}d`;
                      const hourRemainder = Math.floor((duration % 86400) / 3600);
                      return hourRemainder > 0 ? `${dayPart} ${hourRemainder}h` : dayPart;
                    }
                    if (duration >= 3600) {
                      return `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m`;
                    }
                    return `${Math.floor(duration / 60)}m`;
                  })()}
                </span>
              </div>

              {/* Start / End dates */}
              {(() => {
                const startDate = new Date();
                const endDate = new Date(startDate.getTime() + duration * 1000);
                return (
                  <>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400 text-sm">Start date</span>
                      <span className="text-white font-mono text-sm">
                        {formatLocaleDate(startDate, undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-gray-400 text-sm">End date</span>
                      <span className="text-white font-mono text-sm">
                        {formatLocaleDate(endDate, undefined, { month: "short", day: "numeric", year: "numeric" })}
                      </span>
                    </div>
                  </>
                );
              })()}

              {/* Fee breakdown */}
              <div className="border-t border-gray-700 pt-4 space-y-3">
                {feeLoading ? (
                  <p className="text-gray-400 text-xs text-center">Loading fee info…</p>
                ) : (
                  (() => {
                    const amountNum = parseFloat(amount) || 0;
                    const amountStroops = Math.round(amountNum * 10_000_000);
                    const { fee, net, feePercent } = calcWithdrawBreakdown(amountStroops, feeBasisPoints);
                    const feeDisplay = (fee / 10_000_000).toFixed(7).replace(/\.?0+$/, "") || "0";
                    const netDisplay = (net / 10_000_000).toFixed(7).replace(/\.?0+$/, "");
                    const tokenLabel = selectedToken === CUSTOM_TOKEN_VALUE ? "tokens" : selectedToken;
                    return (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-400 text-sm">
                            Protocol fee{" "}
                            <span className="text-gray-500 text-xs">({feePercent}%)</span>{" "}
                            <a
                              href="/docs/fees"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-green-400 hover:text-green-300 underline underline-offset-2 text-xs ml-1"
                            >
                              how do fees work?
                            </a>
                          </span>
                          <span className="text-yellow-400 font-mono text-sm" data-testid="protocol-fee">
                            {feeDisplay} {tokenLabel}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-gray-400 text-sm">Net to recipient</span>
                          <span className="text-green-400 font-mono text-sm font-semibold" data-testid="net-amount">
                            {netDisplay} {tokenLabel}
                          </span>
                        </div>
                      </>
                    );
                  })()
                )}
              </div>

              {schedulingEnabled && scheduledStart && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Scheduled Start</span>
                  <span className="text-blue-300 font-mono text-sm">
                    {formatLocaleDateTime(new Date(scheduledStart))}
                  </span>
                </div>
              )}
              {!schedulingEnabled && (
                <div className="flex justify-between items-center">
                  <span className="text-gray-400 text-sm">Start</span>
                  <span className="text-white font-mono text-sm">Immediately</span>
                </div>
              )}
              <div className="border-t border-gray-700 pt-4">
                <FlowRatePreview amount={amount} durationSeconds={duration} />
              </div>
              {autoRenew && (
                <div className="flex justify-between items-center border-t border-gray-700 pt-3">
                  <span className="text-gray-400 text-sm">Auto-Renewal</span>
                  <span className="text-green-400 text-sm font-medium">
                    ✓ Enabled
                    {autoRenewDuration > 0 && (
                      <span className="text-gray-400 font-normal ml-1">
                        ({(() => {
                          const s = autoRenewDuration;
                          if (s >= 86400) return `${Math.floor(s / 86400)}d`;
                          if (s >= 3600) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
                          return `${Math.floor(s / 60)}m`;
                        })()})
                      </span>
                    )}
                  </span>
                </div>
              )}
              {gasFee && (
                <div className="flex justify-between items-center border-t border-gray-700 pt-3">
                  <span className="text-gray-400 text-sm">Est. network fee</span>
                  <span className="text-gray-300 font-mono text-sm">{gasFee.feeFormatted} XLM</span>
                </div>
              )}
              {feeBumpEnabled && feeSponsorAddress && (
                <div className="flex justify-between items-center border-t border-gray-700 pt-3">
                  <span className="text-gray-400 text-sm">Fee sponsorship</span>
                  <span className="flex items-center gap-1.5 text-blue-400 text-sm font-medium">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    </svg>
                    Sponsored
                  </span>
                </div>
              )}
            </div>

            {/* Collateral Required section — shown when sender is subject to the requirement */}
            {isNewSender && collateralBps !== null && collateralBps > 0 && (() => {
              const depositStroops = Math.round(parseFloat(amount || "0") * 10_000_000);
              const collateralStroops = calcCollateral(depositStroops, collateralBps);
              const totalStroops = depositStroops + collateralStroops;
              const collateralAmt = (collateralStroops / 10_000_000).toLocaleString(undefined, { minimumFractionDigits: 7 });
              const totalAmt = (totalStroops / 10_000_000).toLocaleString(undefined, { minimumFractionDigits: 7 });
              const token = selectedToken === CUSTOM_TOKEN_VALUE ? "tokens" : selectedToken;
              const pct = (collateralBps / 100).toFixed(2);
              return (
                <div
                  role="note"
                  aria-label="Collateral requirement"
                  className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4 space-y-3"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-yellow-400 text-base" aria-hidden="true">⚠</span>
                    <p className="text-yellow-300 text-sm font-semibold">Collateral Required</p>
                    <Tooltip label="When is collateral returned?" align="right" triggerClassName="text-gray-400 hover:text-gray-200 text-xs border border-gray-600 rounded-full w-5 h-5 flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500">
                        The protocol holds collateral from first-time senders to ensure
                        the stream can be fulfilled. Your collateral is automatically
                        returned to your wallet when the stream ends or is cancelled,
                        provided no dispute is raised.
                      </Tooltip>
                  </div>
                  <p className="text-gray-400 text-xs">
                    As a new sender, the protocol requires {pct}% collateral to be locked for the duration of the stream.
                  </p>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Stream amount</span>
                      <span className="text-white font-mono">{amount} {token}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Collateral ({pct}%)</span>
                      <span className="text-yellow-300 font-mono">{collateralAmt} {token}</span>
                    </div>
                    <div className="flex justify-between border-t border-gray-700 pt-2">
                      <span className="text-gray-300 font-medium">Total required</span>
                      <span className="text-white font-mono font-semibold">{totalAmt} {token}</span>
                    </div>
                  </div>
                </div>
              );
            })()}
            {/* Fee estimation — simulated pre-sign */}
            <FeeEstimationPanel active={step === "review"} />

            {/* Large-amount typed confirmation (#428) */}
            {requiresTypedConfirm && (
              <div
                role="group"
                aria-label="Large amount confirmation"
                className="bg-yellow-900/20 border border-yellow-700/50 rounded-xl p-4 space-y-3"
              >
                <div className="flex items-center gap-2">
                  <span className="text-yellow-400 text-base" aria-hidden="true">🔒</span>
                  <p className="text-yellow-300 text-sm font-semibold">Large amount — confirmation required</p>
                </div>
                <p className="text-gray-300 text-sm">
                  This stream is at or above your{" "}
                  <span className="font-mono font-semibold text-yellow-300">
                    {streamThreshold.toLocaleString()} {selectedToken === CUSTOM_TOKEN_VALUE ? "tokens" : selectedToken}
                  </span>{" "}
                  threshold. Type <span className="font-mono font-semibold text-white">{parseFloat(amount)}</span>{" "}
                  to enable signing.
                </p>
                <input
                  id="confirm-amount"
                  type="text"
                  inputMode="decimal"
                  value={confirmAmountInput}
                  onChange={(e) => setConfirmAmountInput(e.target.value)}
                  placeholder={t("amount_placeholder")}
                  autoComplete="off"
                  className="w-full bg-gray-800 border border-gray-600 rounded-lg px-4 py-3 text-white font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
                  aria-label={`Type ${parseFloat(amount)} to confirm this large stream`}
                  aria-invalid={confirmAmountInput.length > 0 && !confirmAmountMatches}
                  aria-describedby="confirm-amount-status"
                  data-testid="confirm-amount-input"
                />
                <p
                  id="confirm-amount-status"
                  aria-live="polite"
                  className={`text-xs ${
                    confirmAmountMatches ? "text-green-400" : "text-gray-500"
                  }`}
                >
                  {confirmAmountInput.length === 0
                    ? "Waiting for typed confirmation…"
                    : confirmAmountMatches
                    ? "✓ Amount confirmed — you can now sign."
                    : "Typed amount does not match yet."}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Navigation */}
        <div className="flex gap-4 mt-8">
          {step !== "recipient" && (
            <button
              type="button"
              onClick={goBack}
              disabled={loading}
              className="flex-1 border border-gray-600 text-gray-300 py-3 rounded-lg font-medium hover:bg-gray-700 disabled:opacity-50 transition-colors"
            >
              Back
            </button>
          )}
          {step === "preview" ? (
            <button
              type="button"
              onClick={goConfirmPreview}
              disabled={loading}
              className="flex-1 bg-green-700 text-white py-3 rounded-lg font-medium hover:bg-green-800 disabled:opacity-50 transition-colors"
            >
              Confirm
            </button>
          ) : step !== "review" ? (
            <button
              type="button"
              onClick={goNext}
              disabled={!canGoNext}
              className="flex-1 bg-green-700 text-white py-3 rounded-lg font-medium hover:bg-green-800 disabled:opacity-50 transition-colors"
            >
              Next
            </button>
          ) : (
            <button
              type="button"
              onClick={handleCreateStream}
              disabled={loading || undoCountdown !== null || !confirmAmountMatches || showTopUpBanner}
              aria-label="Confirm and sign transaction"
              aria-disabled={loading || undoCountdown !== null || !confirmAmountMatches || showTopUpBanner}
              data-testid="confirm-sign-button"
              className="flex-1 bg-green-700 text-white py-3 rounded-lg font-medium hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors inline-flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg
                    className="animate-spin h-4 w-4"
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Waiting for wallet…
                </>
              ) : (
                "Confirm and Sign"
              )}
            </button>
          )}
        </div>
        </div>
        )}
      </div>
    </main>
  );
}

export default function NewStreamPage() {
  return (
    <Suspense fallback={<main id="main-content" tabIndex={-1} className="min-h-screen bg-gray-900 text-white p-4 sm:p-8"><div className="max-w-lg mx-auto"><SkeletonForm /></div></main>}>
      <NewStreamWizard />
    </Suspense>
  );
}
