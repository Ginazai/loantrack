import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";

/** Shows the router's current path so tests can assert on navigation. */
export function LocationDisplay() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

/** Fresh QueryClient (no retries, no cache reuse) + MemoryRouter for every render. */
export function renderWithProviders(ui: ReactElement, { route = "/" }: { route?: string } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        {ui}
        <LocationDisplay />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { client, ...utils };
}
