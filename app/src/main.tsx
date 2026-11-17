import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./styles-v6.css";
import "./styles-v9.css";
import "./styles-v10.css";
import "./styles-v11.css";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
