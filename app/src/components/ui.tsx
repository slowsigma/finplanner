// SPDX-License-Identifier: Apache-2.0
import type { FormEvent, ReactNode } from "react";

export const money = (n: number): string =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;

export function FormRow({ children, onSubmit, testid }: { children: ReactNode; onSubmit: (values: FormData) => void; testid: string }) {
  return (
    <form
      className="inline"
      data-testid={testid}
      onSubmit={(e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        onSubmit(new FormData(e.currentTarget));
      }}
    >
      {children}
    </form>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label>{label}{children}</label>;
}

export function Submit({ label }: { label: string }) {
  return <button className="primary" type="submit">{label}</button>;
}

export function DeleteButton({ onDelete, testid }: { onDelete: () => void; testid: string }) {
  return (
    <button
      className="link"
      type="button"
      data-testid={testid}
      onClick={onDelete}
      aria-label="delete"
    >
      ✕
    </button>
  );
}
