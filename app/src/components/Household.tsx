// SPDX-License-Identifier: Apache-2.0
import { useState } from "react";
import type { AppDatabase } from "../db/sqlite.ts";
import {
  addPerson,
  createHousehold,
  deletePerson,
  householdId,
  householdLabel,
  listPersons,
} from "../db/repo.ts";
import { DeleteButton, Field, FormRow, Submit } from "./ui.tsx";

export function Household({ db, version, refresh }: { db: AppDatabase; version: number; refresh: () => void }) {
  void version;
  const [error, setError] = useState("");
  const household = householdId(db);
  const persons = listPersons(db);

  const guard = (fn: () => void) => () => {
    setError("");
    try {
      fn();
      refresh();
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <>
      {household === undefined && (
        <section className="card">
          <h2>Set up household</h2>
          <FormRow
            testid="create-household"
            onSubmit={(values) =>
              guard(() => createHousehold(db, String(values.get("label") || "My household")))()
            }
          >
            <Field label="Household name">
              <input type="text" name="label" defaultValue="My household" data-testid="household-label" />
            </Field>
            <Submit label="Create household" />
          </FormRow>
        </section>
      )}
      {household !== undefined && (
        <section className="card">
          <h2>{householdLabel(db)}</h2>
          <table data-testid="people-table">
            <thead>
              <tr><th>Name</th><th>Birth year</th><th>Retirement age</th><th /></tr>
            </thead>
            <tbody>
              {persons.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{p.birth_year}</td>
                  <td>{p.planned_retirement_age ?? "—"}</td>
                  <td><DeleteButton testid={`delete-person-${p.id}`} onDelete={guard(() => deletePerson(db, p.id))} /></td>
                </tr>
              ))}
              {persons.length === 0 && <tr><td colSpan={4} className="dim">No adults yet.</td></tr>}
            </tbody>
          </table>
          {error && <p className="err">{error}</p>}
          <FormRow
            testid="add-person"
            onSubmit={(values) =>
              guard(() => {
                const retirement = values.get("retirement");
                addPerson(db, household!, {
                  name: String(values.get("name")),
                  birth_year: Number(values.get("birth_year")),
                  sex: String(values.get("sex")),
                  planned_retirement_age: retirement ? Number(retirement) : null,
                });
              })()
            }
          >
            <Field label="Name"><input type="text" name="name" required data-testid="person-name" /></Field>
            <Field label="Birth year"><input type="number" name="birth_year" required min={1900} max={2100} data-testid="person-birth" /></Field>
            <Field label="Sex">
              <select name="sex" data-testid="person-sex">
                <option value="f">female</option>
                <option value="m">male</option>
              </select>
            </Field>
            <Field label="Retirement age"><input type="number" name="retirement" min={50} max={78} data-testid="person-retirement" /></Field>
            <Submit label="Add adult" />
          </FormRow>
        </section>
      )}
      <p className="note dim">
        Two-adult households are fully supported; per-person and merged views appear throughout.
        No data ever leaves this device.
      </p>
    </>
  );
}
