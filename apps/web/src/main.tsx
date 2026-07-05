import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ThemeProvider } from "next-themes";
import App from "./App";
import { loadWebPlugins } from "./plugins/loader";
import "./index.css";

function Bootstrap() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void loadWebPlugins().finally(() => setReady(true));
  }, []);
  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center bg-background text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }
  return <App />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <BrowserRouter>
        <Bootstrap />
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>
);
