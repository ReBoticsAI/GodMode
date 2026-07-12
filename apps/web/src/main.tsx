import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import { installPluginHostBridge } from "@/plugins/host-bridge";
import App from "./App";
import "@xyflow/react/dist/style.css";
import "./index.css";

// Must run before plugin web bundles resolve /plugin-shims/* (production import map).
installPluginHostBridge();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
);
