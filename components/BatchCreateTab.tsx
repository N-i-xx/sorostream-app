"use client";

import { useState, useRef, useCallback } from "react";
import { sorostream } from "@/src/lib/sorostream";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CsvRow {
  rowIndex: number;
  recipient: string;
  amount: string;
  duration: string;
  cliff_days: string;
  token: string;
}

interface ParsedRow {
  rowIndex: number;
  recipient: string;
  amount: string;
  duration: string;
  cliff_days: string;
  token: string;
  errors: string[];
}

type RowStatus = "idle" | "success" | "error";

interface SubmitResult {
  rowIndex: number;
  status: RowStatus;
  message: string;
}

// ---------------------------------------------------------------------------
// CSV parsing & validation
// ---------------------------------------------------------------------------

const REQUIRED_HEADERS = ["recipient", "amount", "duration", "cliff_days", "token"] as const;

export function parseCSV(text: string): { rows: CsvRow[]; headerError: string | null } {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { rows: [], headerError: "CSV must have a header row and at least one data row." };
  }

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  for (const req of REQUIRED_HEADERS) {
    if (!headers.includes(req)) {
      return {
        rows: [],
        headerError: `Missing required column: "${req}". Required: ${REQUIRED_HEADERS.join(", ")}.`,
      };
    }
  }

  const idx = Object.fromEntries(headers.map((h, i) => [h, i]));

  const rows: CsvRow[] = lines.slice(1).map((line, i) => {
    const cols = line.split(",").map((c) => c.trim());
    return {
      rowIndex: i + 2, // 1-indexed, row 1 = header
      recipient: cols[idx.recipient] ?? "",
      amount: cols[idx.amount] ?? "",
      duration: cols[idx.duration] ?? "",
      cliff_days: cols[idx.cliff_days] ?? "",
      token: cols[idx.token] ?? "",
    };
  });

  return { rows, headerError: null };
}

function validateRow(row: CsvRow): string[] {
  const errors: string[] = [];

  if (!row.recipient) {
    errors.push("recipient is required");
  } else if (!/^G[A-Z2-7]{55}$/.test(row.recipient)) {
    errors.push("recipient must be a valid Stellar public key (G…, 56 chars)");
  }

  const amount = parseFloat(row.amount);
  if (!row.amount) {
    errors.push("amount is required");
  } else if (isNaN(amount) || amount <= 0) {
    errors.push("amount must be a positive number");
  }

  const duration = parseInt(row.duration, 10);
  if (!row.duration) {
    errors.push("duration is required");
  } else if (isNaN(duration) || duration <= 0) {
    errors.push("duration must be a positive integer (seconds)");
  }

  const cliff = parseInt(row.cliff_days, 10);
  if (row.cliff_days && (isNaN(cliff) || cliff < 0)) {
    errors.push("cliff_days must be a non-negative integer");
  }

  if (!row.token) {
    errors.push("token is required");
  }

  return errors;
}

// ---------------------------------------------------------------------------
// CSV template
// ---------------------------------------------------------------------------

const CSV_TEMPLATE = `recipient,amount,duration,cliff_days,token
GBCR7QXZD4XKQNLKFM7JOXNJ4RSDQKPFZVZLHXMKXYXT5RDRL7XDRL,100,2592000,0,USDC
GDEF3XYZKQNP7LKFM7JOXNJ4RSDQKPFZVZLHXMKXYXT5RDRL7XABC,250,7776000,30,USDC
GHIJ5KLMNQ4XKQNLKFM7JOXNJ4RSDQKPFZVZLHXMKXYXT5RDRL7XYZ,500,31536000,90,XLM
`;

function downloadTemplate() {
  const blob = new Blob([CSV_TEMPLATE], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "sorostream-batch-template.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BatchCreateTab() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [headerError, setHeaderError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState<SubmitResult[]>([]);
  const [submitted, setSubmitted] = useState(false);

  // ---------------------------------------------------
  // Parse uploaded file
  // ---------------------------------------------------
  const handleFile = useCallback((file: File) => {
    setFileName(file.name);
    setResults([]);
    setSubmitted(false);

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { rows: csvRows, headerError: hErr } = parseCSV(text);
      setHeaderError(hErr);

      const parsed: ParsedRow[] = csvRows.map((row) => ({
        ...row,
        errors: validateRow(row),
      }));
      setRows(parsed);
    };
    reader.readAsText(file);
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  // ---------------------------------------------------
  // Submit batch
  // ---------------------------------------------------
  async function handleSubmit() {
    const validRows = rows.filter((r) => r.errors.length === 0);
    if (validRows.length === 0) return;

    setSubmitting(true);
    setSubmitted(false);

    // Build initial result list: mark invalid rows as skipped
    const resultList: SubmitResult[] = rows.map((row) =>
      row.errors.length > 0
        ? { rowIndex: row.rowIndex, status: "error" as RowStatus, message: `Skipped: ${row.errors[0]}` }
        : { rowIndex: row.rowIndex, status: "idle" as RowStatus, message: "" },
    );
    setResults(resultList);

    try {
      // Submit all valid rows as a single batch_create contract instruction.
      const batchParams = validRows.map((row) => ({
        recipient: row.recipient,
        amount: row.amount,
        durationSeconds: parseInt(row.duration, 10),
        token: row.token,
      }));

      const batchResult = await sorostream.batch_create(batchParams);

      // Map batch results back to row indices
      const finalResults: SubmitResult[] = [...resultList];
      batchResult.results.forEach((res) => {
        // res.index is the index into validRows
        const row = validRows[res.index];
        if (!row) return;
        const listIdx = finalResults.findIndex((r) => r.rowIndex === row.rowIndex);
        if (listIdx === -1) return;
        if (res.error) {
          finalResults[listIdx] = {
            rowIndex: row.rowIndex,
            status: "error",
            message: res.error,
          };
        } else {
          finalResults[listIdx] = {
            rowIndex: row.rowIndex,
            status: "success",
            message: `Stream ${res.streamId} created. Tx: ${batchResult.txHash}`,
          };
        }
      });

      setResults(finalResults);
    } catch (err) {
      // Entire batch failed
      const errorMsg = err instanceof Error ? err.message : "Batch transaction failed.";
      const failedResults: SubmitResult[] = rows.map((row) => ({
        rowIndex: row.rowIndex,
        status: row.errors.length > 0 ? ("error" as RowStatus) : ("error" as RowStatus),
        message: row.errors.length > 0 ? `Skipped: ${row.errors[0]}` : errorMsg,
      }));
      setResults(failedResults);
    } finally {
      setSubmitting(false);
      setSubmitted(true);
    }
  }

  // ---------------------------------------------------
  // Derived state
  // ---------------------------------------------------
  const validCount = rows.filter((r) => r.errors.length === 0).length;
  const invalidCount = rows.filter((r) => r.errors.length > 0).length;
  const canSubmit = !submitting && validCount > 0 && !submitted;

  const successCount = results.filter((r) => r.status === "success").length;
  const failCount = results.filter((r) => r.status === "error").length;

  // ---------------------------------------------------
  // Render
  // ---------------------------------------------------
  return (
    <div className="space-y-6">
      {/* Download template */}
      <div className="flex items-center justify-between">
        <p className="text-gray-400 text-sm">
          Upload a CSV to create multiple streams at once.
        </p>
        <button
          type="button"
          onClick={downloadTemplate}
          className="text-xs text-green-400 hover:text-green-300 border border-green-800 hover:border-green-600 px-3 py-1.5 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
        >
          ↓ Download Template
        </button>
      </div>

      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        aria-label="Upload CSV file"
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
        }}
        className="border-2 border-dashed border-gray-600 hover:border-green-600 rounded-xl p-8 text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={handleFileChange}
          aria-label="CSV file input"
        />
        <div className="text-3xl mb-2">📄</div>
        {fileName ? (
          <p className="text-white font-medium">{fileName}</p>
        ) : (
          <>
            <p className="text-gray-300 font-medium">
              Drop your CSV here or click to browse
            </p>
            <p className="text-gray-500 text-xs mt-1">
              Columns: recipient, amount, duration (seconds), cliff_days, token
            </p>
          </>
        )}
      </div>

      {/* Header error */}
      {headerError && (
        <div
          role="alert"
          className="bg-red-900/40 border border-red-700 text-red-300 rounded-xl px-4 py-3 text-sm"
        >
          {headerError}
        </div>
      )}

      {/* Summary bar */}
      {rows.length > 0 && !headerError && (
        <div className="flex gap-4 text-sm">
          <span className="text-gray-300">
            <span className="font-semibold text-white">{rows.length}</span> rows parsed
          </span>
          {validCount > 0 && (
            <span className="text-green-400">
              <span className="font-semibold">{validCount}</span> valid
            </span>
          )}
          {invalidCount > 0 && (
            <span className="text-red-400">
              <span className="font-semibold">{invalidCount}</span> invalid
            </span>
          )}
        </div>
      )}

      {/* Preview table */}
      {rows.length > 0 && !headerError && (
        <div className="overflow-x-auto rounded-xl border border-gray-700">
          <table className="w-full text-xs text-start min-w-[640px]">
            <thead>
              <tr className="bg-gray-800 text-gray-400 uppercase tracking-wider">
                <th className="px-3 py-2.5 w-8">#</th>
                <th className="px-3 py-2.5">Recipient</th>
                <th className="px-3 py-2.5">Amount</th>
                <th className="px-3 py-2.5">Duration (s)</th>
                <th className="px-3 py-2.5">Cliff days</th>
                <th className="px-3 py-2.5">Token</th>
                <th className="px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const result = results.find((r) => r.rowIndex === row.rowIndex);
                const hasErrors = row.errors.length > 0;

                return (
                  <tr
                    key={row.rowIndex}
                    className={`border-t border-gray-800 ${
                      hasErrors
                        ? "bg-red-950/30"
                        : result?.status === "success"
                        ? "bg-green-950/30"
                        : "bg-gray-900"
                    }`}
                  >
                    <td className="px-3 py-2.5 text-gray-500">{row.rowIndex}</td>
                    <td className="px-3 py-2.5 font-mono text-gray-300 max-w-[140px] truncate">
                      {row.recipient || <span className="text-red-400 italic">missing</span>}
                    </td>
                    <td className="px-3 py-2.5 text-gray-300">
                      {row.amount || <span className="text-red-400 italic">missing</span>}
                    </td>
                    <td className="px-3 py-2.5 text-gray-300">
                      {row.duration || <span className="text-red-400 italic">missing</span>}
                    </td>
                    <td className="px-3 py-2.5 text-gray-300">{row.cliff_days || "0"}</td>
                    <td className="px-3 py-2.5 text-gray-300">
                      {row.token || <span className="text-red-400 italic">missing</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      {result ? (
                        <span
                          className={`font-medium ${
                            result.status === "success"
                              ? "text-green-400"
                              : "text-red-400"
                          }`}
                        >
                          {result.status === "success" ? "✓ OK" : `✗ ${result.message}`}
                        </span>
                      ) : hasErrors ? (
                        <span
                          className="text-red-400"
                          title={row.errors.join("; ")}
                        >
                          ✗ {row.errors[0]}
                          {row.errors.length > 1 && ` (+${row.errors.length - 1})`}
                        </span>
                      ) : (
                        <span className="text-gray-500">Ready</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Submit result summary */}
      {submitted && (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-xl border px-4 py-3 text-sm ${
            failCount === 0
              ? "bg-green-900/30 border-green-700 text-green-300"
              : successCount === 0
              ? "bg-red-900/30 border-red-700 text-red-300"
              : "bg-yellow-900/30 border-yellow-700 text-yellow-300"
          }`}
        >
          {failCount === 0
            ? `🎉 All ${successCount} streams created successfully!`
            : successCount === 0
            ? `All ${failCount} rows failed. Check errors above.`
            : `${successCount} streams created, ${failCount} failed. See per-row status above.`}
        </div>
      )}

      {/* Submit button */}
      {rows.length > 0 && !headerError && (
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full bg-green-700 text-white py-3 rounded-lg font-medium hover:bg-green-800 disabled:opacity-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
        >
          {submitting
            ? "Submitting batch…"
            : submitted
            ? "Submitted"
            : `Create ${validCount} Stream${validCount !== 1 ? "s" : ""}`}
        </button>
      )}
    </div>
  );
}
