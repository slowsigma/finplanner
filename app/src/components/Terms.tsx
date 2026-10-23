// SPDX-License-Identifier: Apache-2.0
// ToU1 clickwrap + ToU2 recorded acceptance + ToU3 persistent notices.
// The text is the counsel DRAFT (docs/LEGAL_TERMS_DRAFT.md, D14) bundled
// locally — swapping in the attorney-approved final text is a file swap +
// TOU_VERSION bump, which re-prompts every existing user.
import { useEffect, useRef, useState } from "react";
import TOU_MD from "../../../docs/LEGAL_TERMS_DRAFT.md?raw";
import type { AppDatabase } from "../db/sqlite.ts";
import { clearTouAcceptance, listTouAcceptance, recordTouAcceptance } from "../db/repo.ts";

export const TOU_VERSION = "0.1-draft";

export const TOU_FOOTER =
  "Projections are model outputs from your assumptions — not advice or predictions. Verify before acting; consult a licensed professional.";

export function touAccepted(db: AppDatabase): boolean {
  return listTouAcceptance(db).some((r) => r.version === TOU_VERSION);
}

function TermsText({ scrollRef }: { scrollRef?: React.RefObject<HTMLPreElement | null> }) {
  return (
    <pre className="tou-text" data-testid="tou-scroll" tabIndex={0} ref={scrollRef}>
      {TOU_MD}
    </pre>
  );
}

function useScrollEnd(ref: React.RefObject<HTMLElement | null>, onEnd: () => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 8) onEnd();
    };
    check();
    el.addEventListener("scroll", check, { passive: true });
    return () => el.removeEventListener("scroll", check);
  }, [ref, onEnd]);
}

export function TermsGate({ db, onAccept }: { db: AppDatabase; onAccept: () => void }) {
  const [read, setRead] = useState(false);
  const [checked, setChecked] = useState(false);
  const [declined, setDeclined] = useState(false);
  const boxRef = useRef<HTMLPreElement>(null);
  useScrollEnd(boxRef, () => setRead(true));
  if (declined) {
    return (
      <div className="tou-gate" data-testid="tou-declined">
        <h2>FinPlanner needs your agreement</h2>
        <p>
          This tool makes consequential-seeming projections from your data, so we ask
          every first-time user to read and accept the terms before starting. You can
          reload the page and reconsider at any time — nothing was stored.
        </p>
        <button type="button" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
  return (
    <div className="tou-gate" data-testid="tou-gate">
      <h2>Before you begin — please read and agree</h2>
      <p className="dim">
        Terms version {TOU_VERSION} · DRAFT pending counsel sign-off · fully local;
        your data and this agreement never leave this device.
      </p>
      <TermsText scrollRef={boxRef} />
      <label className="tou-check">
        <input
          type="checkbox"
          data-testid="tou-confirm"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
        />
        I have read, understood, and agree to the Terms of Use. I understand FinPlanner
        is not financial, tax, or legal advice, and I accept sole responsibility for my
        own decisions.
      </label>
      <div className="tou-actions">
        <button
          type="button"
          data-testid="tou-agree"
          disabled={!read || !checked}
          onClick={() => {
            recordTouAcceptance(db, TOU_VERSION);
            onAccept();
          }}
        >
          {read ? "Agree and continue" : "Scroll to the end to enable"}
        </button>
        <button type="button" data-testid="tou-decline" onClick={() => setDeclined(true)}>Decline</button>
      </div>
    </div>
  );
}

export function TermsSettingsCard({ db, onReset }: { db: AppDatabase; onReset: () => void }) {
  const [reading, setReading] = useState(false);
  const accepted = listTouAcceptance(db).find((r) => r.version === TOU_VERSION);
  return (
    <section className="card" data-testid="tou-settings">
      <h2>Terms of Use</h2>
      <p>
        {accepted
          ? `Accepted version ${accepted.version} on ${accepted.accepted_at.slice(0, 10)}.`
          : `Version ${TOU_VERSION} has not been accepted on this device yet.`}
      </p>
      <p className="dim">{TOU_FOOTER}</p>
      <div className="tou-actions">
        <button type="button" data-testid="tou-reread" onClick={() => setReading((v) => !v)}>
          {reading ? "Close" : "Re-read terms"}
        </button>
        <button
          type="button"
          data-testid="tou-reset"
          onClick={() => {
            clearTouAcceptance(db);
            onReset();
          }}
        >
          Reset acceptance
        </button>
      </div>
      {reading && <TermsText />}
    </section>
  );
}
