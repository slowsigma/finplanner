// SPDX-License-Identifier: Apache-2.0
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { openAppDb } from "./db/repo.ts";
import { App } from "./App.tsx";
import "./styles.css";

// D6: the service worker precaches the built bundle only — it never
// fetches through to the network (see vite.config workbox config).
registerSW({ immediate: true });

const root = document.getElementById("root");
if (!root) throw new Error("missing #root");

openAppDb()
  .then((db) => {
    createRoot(root!).render(
      <StrictMode>
        <App db={db} />
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    root!.innerHTML = `<div class="boot"><h1>FinPlanner failed to start</h1><p class="err">${String(error)}</p></div>`;
  });
