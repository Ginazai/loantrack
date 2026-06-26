import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import "./index.css";

// Apply DaisyUI theme before first render so there's no flash of unstyled content.
// uiStore persists the user's choice; on the very first visit we fall back to "light".
const stored = (() => {
  try {
    return JSON.parse(localStorage.getItem("ui") || "{}");
  } catch {
    return {};
  }
})();
const theme = stored?.state?.theme ?? "light";
document.documentElement.setAttribute("data-theme", theme);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);
