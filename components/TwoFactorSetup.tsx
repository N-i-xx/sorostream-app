"use client";

import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import QRCode from "qrcode";
import {
  generateSecret,
  generateTOTPURI,
  generateRecoveryCodes,
  validateTOTP,
  hashSecret,
  isValidRecoveryCode,
  formatRecoveryCode,
} from "@/src/lib/totp";

type SetupStep = "intro" | "scan" | "verify" | "recovery" | "complete";

/**
 * Set when a setup attempt is abandoned (cancelled or navigated away from)
 * after its secret was shown, so the user may already have an authenticator
 * entry for it. Holds no secret, only the fact.
 */
export const ABANDONED_SETUP_KEY = "sorostream-2fa-abandoned-setup";

function readAbandonedFlag(): boolean {
  try {
    return localStorage.getItem(ABANDONED_SETUP_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAbandonedFlag(abandoned: boolean): void {
  try {
    if (abandoned) localStorage.setItem(ABANDONED_SETUP_KEY, "1");
    else localStorage.removeItem(ABANDONED_SETUP_KEY);
  } catch {
    // Storage unavailable: the stale-entry warning is best effort.
  }
}

interface TwoFactorSetupProps {
  onComplete: () => void;
  onCancel: () => void;
  accountName: string;
}

export default function TwoFactorSetup({
  onComplete,
  onCancel,
  accountName,
}: TwoFactorSetupProps) {
  const [step, setStep] = useState<SetupStep>("intro");
  const [secret, setSecret] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [verificationCode, setVerificationCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // An earlier attempt was abandoned after showing its secret, so the user's
  // authenticator may hold an entry that will never work.
  const [previousAttemptAbandoned, setPreviousAttemptAbandoned] = useState(false);
  // True from the moment a secret is shown until setup completes.
  const secretShownRef = useRef(false);

  useEffect(() => {
    setPreviousAttemptAbandoned(readAbandonedFlag());
    return () => {
      // Unmounting mid-setup (Cancel, or navigating away) abandons the
      // secret: a restart generates a new one, so remember to warn.
      if (secretShownRef.current) writeAbandonedFlag(true);
    };
  }, []);

  // Each setup attempt gets one secret: it is generated the first time the
  // scan step is shown and kept when the user goes back to it from verify,
  // so a code that was already scanned stays valid. A restarted setup (a new
  // mount) always generates a fresh secret. The abandoned one is never
  // stored, so it can't be resumed, and the scan step warns that the old
  // authenticator entry is stale.
  useEffect(() => {
    if (step !== "scan" || secret) return;
    const newSecret = generateSecret();
    setSecret(newSecret);
    secretShownRef.current = true;

    const totpUri = generateTOTPURI(newSecret, accountName);
    QRCode.toDataURL(totpUri, (err, url) => {
      if (err) {
        console.error("Failed to generate QR code:", err);
      } else {
        setQrCodeUrl(url);
      }
    });
  }, [step, secret, accountName]);

  useEffect(() => {
    if (step === "complete") {
      secretShownRef.current = false;
      writeAbandonedFlag(false);
    }
  }, [step]);

  // Generate recovery codes when entering recovery step
  useEffect(() => {
    if (step === "recovery") {
      setRecoveryCodes(generateRecoveryCodes());
    }
  }, [step]);

  const handleStartSetup = () => {
    setStep("scan");
  };

  const handleVerifyCode = async () => {
    setError("");
    
    if (!validateTOTP(secret, verificationCode)) {
      setError("Invalid code format. Please enter a 6-digit code.");
      return;
    }

    setLoading(true);
    
    // Simulate verification (in production, this would call your backend)
    setTimeout(() => {
      setLoading(false);
      // For demo, accept any valid format
      if (verificationCode === "000000") {
        setError("Invalid code. Please try again.");
      } else {
        setStep("recovery");
      }
    }, 1000);
  };

  const handleSaveRecoveryCodes = async () => {
    setLoading(true);
    
    // In production, save the hashed secret and recovery codes to your backend
    const hashedSecret = await hashSecret(secret);
    console.log("Hashed secret to store:", hashedSecret);
    console.log("Recovery codes to store:", recoveryCodes);
    
    setTimeout(() => {
      setLoading(false);
      setStep("complete");
    }, 1000);
  };

  const handleComplete = () => {
    onComplete();
  };

  return (
    <div className="bg-gray-800 rounded-xl p-6 max-w-md mx-auto">
      {step === "intro" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Enable Two-Factor Authentication</h2>
          <p className="text-gray-400 text-sm">
            Add an extra layer of security to your account by requiring a code from your authenticator app when logging in.
          </p>
          <div className="bg-gray-700 rounded-lg p-4 space-y-2">
            <h3 className="font-medium text-white text-sm">{"You'll need:"}</h3>
            <h3 className="font-medium text-white text-sm">You&apos;ll need:</h3>
            <ul className="text-gray-400 text-xs space-y-1 list-disc list-inside">
              <li>An authenticator app (Google Authenticator, Authy, 1Password, etc.)</li>
              <li>A few minutes to complete the setup</li>
              <li>A safe place to store your recovery codes</li>
            </ul>
          </div>
          <div className="flex gap-3">
            <button
              onClick={handleStartSetup}
              className="flex-1 bg-green-700 text-white py-2 rounded-lg font-medium hover:bg-green-800 transition-colors"
            >
              Get Started
            </button>
            <button
              onClick={onCancel}
              className="flex-1 border border-gray-600 text-gray-300 py-2 rounded-lg font-medium hover:bg-gray-700 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {step === "scan" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Scan QR Code</h2>
          <p className="text-gray-400 text-sm">
            Open your authenticator app and scan the QR code below:
          </p>

          {previousAttemptAbandoned && (
            <div role="alert" className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-3">
              <p className="text-yellow-400 text-xs">
                This is a new code. If you scanned one during an earlier, unfinished setup, delete
                that SoroStream entry from your authenticator app: its codes will not work.
              </p>
            </div>
          )}

          {qrCodeUrl ? (
            <div className="flex justify-center bg-white p-4 rounded-lg">
              <Image src={qrCodeUrl} alt="TOTP QR Code" width={192} height={192} />
            </div>
          ) : (
            <div className="flex justify-center bg-gray-700 p-4 rounded-lg">
              <div className="w-48 h-48 flex items-center justify-center text-gray-400">
                Generating QR code...
              </div>
            </div>
          )}

          <div className="bg-gray-700 rounded-lg p-3">
            <p className="text-xs text-gray-400 mb-2">Or enter this code manually:</p>
            <code className="text-sm text-white font-mono break-all">{secret}</code>
          </div>

          <button
            onClick={() => setStep("verify")}
            className="w-full bg-green-700 text-white py-2 rounded-lg font-medium hover:bg-green-800 transition-colors"
          >
            {"I've Scanned the QR Code"}
            I&apos;ve Scanned the QR Code
          </button>
          
          <button
            onClick={onCancel}
            className="w-full border border-gray-600 text-gray-300 py-2 rounded-lg font-medium hover:bg-gray-700 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {step === "verify" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Verify Setup</h2>
          <p className="text-gray-400 text-sm">
            Enter the 6-digit code from your authenticator app to verify the setup:
          </p>
          
          <input
            type="text"
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value)}
            placeholder="000000"
            maxLength={6}
            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white text-center text-2xl tracking-widest font-mono focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500"
            autoFocus
          />
          
          {error && (
            <p className="text-red-400 text-sm">{error}</p>
          )}

          <button
            onClick={handleVerifyCode}
            disabled={loading || verificationCode.length !== 6}
            className="w-full bg-green-700 text-white py-2 rounded-lg font-medium hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Verifying..." : "Verify Code"}
          </button>
          
          <button
            onClick={() => setStep("scan")}
            className="w-full border border-gray-600 text-gray-300 py-2 rounded-lg font-medium hover:bg-gray-700 transition-colors"
          >
            Back
          </button>
        </div>
      )}

      {step === "recovery" && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-white">Save Recovery Codes</h2>
          <p className="text-gray-400 text-sm">
            These recovery codes can be used to access your account if you lose your authenticator device. Save them in a safe place.
          </p>
          
          <div className="bg-gray-700 rounded-lg p-4 space-y-2">
            {recoveryCodes.map((code, index) => (
              <div key={index} className="font-mono text-sm text-white">
                {formatRecoveryCode(code)}
              </div>
            ))}
          </div>

          <div className="bg-yellow-900/30 border border-yellow-600 rounded-lg p-3">
            <p className="text-yellow-400 text-xs">
              {"⚠️ Important: Store these codes securely. You won't be able to see them again after this step."}
              ⚠️ Important: Store these codes securely. You won&apos;t be able to see them again after this step.
            </p>
          </div>

          <button
            onClick={handleSaveRecoveryCodes}
            disabled={loading}
            className="w-full bg-green-700 text-white py-2 rounded-lg font-medium hover:bg-green-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? "Saving..." : "I&apos;ve Saved My Codes"}
          </button>
          
          <button
            onClick={() => setStep("verify")}
            className="w-full border border-gray-600 text-gray-300 py-2 rounded-lg font-medium hover:bg-gray-700 transition-colors"
          >
            Back
          </button>
        </div>
      )}

      {step === "complete" && (
        <div className="space-y-4 text-center">
          <div className="w-16 h-16 bg-green-700 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          
          <h2 className="text-xl font-semibold text-white">2FA Enabled</h2>
          <p className="text-gray-400 text-sm">
            {"Two-factor authentication is now enabled for your account. You'll be asked for a code when logging in."}
            Two-factor authentication is now enabled for your account. You&apos;ll be asked for a code when logging in.
          </p>

          <button
            onClick={handleComplete}
            className="w-full bg-green-700 text-white py-2 rounded-lg font-medium hover:bg-green-800 transition-colors"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}
