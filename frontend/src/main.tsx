import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { queryClient } from "./lib/api";
import { FocusProvider } from "./lib/focus";
import { ThemeProvider } from "./theme";
import "@fontsource-variable/inter";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {/* Switching focus drops every cached query, so the other side never flashes on screen. */}
        <FocusProvider onChange={() => queryClient.removeQueries()}>
          <App />
        </FocusProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
