import React from "react";
import { createRoot } from "react-dom/client";
import { loadDeployment } from "./config";
import { App } from "./App";
import "./style.css";
const root = createRoot(document.getElementById("root")!);
root.render(
  <main className="startup">
    <p className="eyebrow">Gavel / Auction room</p>
    <h1>Opening the room.</h1>
    <p role="status">
      Loading the deployment and verifying contract interfaces…
    </p>
  </main>,
);
loadDeployment()
  .then((runtime) =>
    root.render(
      <React.StrictMode>
        <App runtime={runtime} />
      </React.StrictMode>,
    ),
  )
  .catch((error) =>
    root.render(
      <main className="startup">
        <h1>Unable to open Gavel</h1>
        <p role="alert">{error.message}</p>
        <button onClick={() => location.reload()}>Reload configuration</button>
      </main>,
    ),
  );
