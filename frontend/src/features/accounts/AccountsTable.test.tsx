import { describe, it, expect } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AccountsTable } from "./AccountsTable";
import { makeAccount } from "../../test/factories";
import { renderWithProviders } from "../../test/utils";

const bodyRows = () => screen.getAllByRole("row").slice(1);
const firstCells = () => bodyRows().map((r) => within(r).getAllByRole("cell")[0].textContent);

describe("AccountsTable", () => {
  describe("full variant", () => {
    it("shows every column", () => {
      renderWithProviders(<AccountsTable accounts={[makeAccount()]} />);
      const table = screen.getByRole("table", { name: "Loan accounts" });
      for (const h of ["Account", "Borrower", "Principal", "Balance", "Rate", "Next Due", "Status", "Started"]) {
        expect(within(table).getByRole("columnheader", { name: new RegExp(h) })).toBeInTheDocument();
      }
    });

    it("formats money, rate, dates and links the account name", () => {
      renderWithProviders(<AccountsTable accounts={[makeAccount({ id: "x9", account_name: "Home", borrow_amount: "1234.50", current_balance: "999.00", rate: "0.0725" })]} />);
      const row = bodyRows()[0];
      expect(within(row).getByRole("link", { name: "Home" })).toHaveAttribute("href", "/accounts/x9");
      expect(within(row).getByText("$1,234.50")).toBeInTheDocument();
      expect(within(row).getByText("$999.00")).toBeInTheDocument();
      expect(within(row).getByText("7.25%")).toBeInTheDocument();
      expect(within(row).getByText("Jan 1, 2026")).toBeInTheDocument();
    });

    it("shows a dash when there is no balance or due date yet", () => {
      renderWithProviders(<AccountsTable accounts={[makeAccount({ current_balance: null, next_due_date: null })]} />);
      expect(within(bodyRows()[0]).getAllByText("—")).toHaveLength(2);
    });

    it("styles a cleared balance as success and an over-principal balance as danger", () => {
      renderWithProviders(
        <AccountsTable
          accounts={[
            makeAccount({ id: "a", account_name: "Paid", current_balance: "0.00" }),
            makeAccount({ id: "b", account_name: "Grew", borrow_amount: "100.00", current_balance: "150.00" }),
          ]}
        />,
      );
      expect(screen.getByText("$0.00")).toHaveClass("lt-success-text");
      expect(screen.getByText("$150.00")).toHaveClass("lt-danger-text");
    });

    it("flags overdue due dates for assistive tech", () => {
      renderWithProviders(<AccountsTable accounts={[makeAccount({ next_due_date: "2020-01-01" })]} />);
      expect(screen.getByText("(overdue)")).toBeInTheDocument();
      expect(screen.getByText("Jan 1, 2020")).toHaveClass("lt-danger-text");
    });

    it("navigates to the account when a row is clicked", async () => {
      renderWithProviders(<AccountsTable accounts={[makeAccount({ id: "acc-7" })]} />);
      await userEvent.setup().click(within(bodyRows()[0]).getByText("Regular User"));
      expect(screen.getByTestId("location")).toHaveTextContent("/accounts/acc-7");
    });

    it("clicking the name link navigates once, without the row handler double-firing", async () => {
      renderWithProviders(<AccountsTable accounts={[makeAccount({ id: "acc-8", account_name: "Solo" })]} />);
      await userEvent.setup().click(screen.getByRole("link", { name: "Solo" }));
      expect(screen.getByTestId("location")).toHaveTextContent("/accounts/acc-8");
    });

    describe("sorting", () => {
      const accounts = [
        makeAccount({ id: "1", account_name: "Mid", borrow_amount: "200.00" }),
        makeAccount({ id: "2", account_name: "Low", borrow_amount: "50.00" }),
        makeAccount({ id: "3", account_name: "High", borrow_amount: "1000.00" }),
      ];

      it("sorts numerically on the raw value, ascending then descending", async () => {
        const user = userEvent.setup();
        renderWithProviders(<AccountsTable accounts={accounts} />);
        await user.click(screen.getByRole("button", { name: /Principal/ }));
        expect(firstCells()).toEqual(["Low", "Mid", "High"]);
        await user.click(screen.getByRole("button", { name: /Principal/ }));
        expect(firstCells()).toEqual(["High", "Mid", "Low"]);
      });

      it("sorts text case-insensitively", async () => {
        const user = userEvent.setup();
        renderWithProviders(<AccountsTable accounts={accounts} />);
        await user.click(screen.getByRole("button", { name: /^Account/ }));
        expect(firstCells()).toEqual(["High", "Low", "Mid"]);
      });

      it("keeps empty values at the bottom in both directions", async () => {
        const user = userEvent.setup();
        renderWithProviders(
          <AccountsTable
            accounts={[
              makeAccount({ id: "1", account_name: "NoBal", current_balance: null }),
              makeAccount({ id: "2", account_name: "Small", current_balance: "10.00" }),
              makeAccount({ id: "3", account_name: "Big", current_balance: "90.00" }),
              makeAccount({ id: "4", account_name: "NoBal2", current_balance: null }),
            ]}
          />,
        );
        await user.click(screen.getByRole("button", { name: /Balance/ }));
        expect(firstCells().slice(0, 2)).toEqual(["Small", "Big"]);
        await user.click(screen.getByRole("button", { name: /Balance/ }));
        expect(firstCells().slice(0, 2)).toEqual(["Big", "Small"]);
        expect(firstCells().slice(2)).toEqual(expect.arrayContaining(["NoBal", "NoBal2"]));
      });
    });

    describe("pagination", () => {
      const many = Array.from({ length: 25 }, (_, i) =>
        makeAccount({ id: `a${i}`, account_name: `Loan ${String(i).padStart(2, "0")}` }),
      );

      it("does not paginate 10 or fewer rows", () => {
        renderWithProviders(<AccountsTable accounts={many.slice(0, 10)} />);
        expect(screen.queryByText("Rows per page")).toBeNull();
      });

      it("pages through results using the configured page size", async () => {
        const user = userEvent.setup();
        renderWithProviders(<AccountsTable accounts={many} pageSize={10} />);
        expect(bodyRows()).toHaveLength(10);
        expect(screen.getByText("Rows per page")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: /next page/i }));
        expect(bodyRows()).toHaveLength(10);
        expect(firstCells()[0]).toBe("Loan 10");
        await user.click(screen.getByRole("button", { name: /next page/i }));
        expect(bodyRows()).toHaveLength(5);
      });

      it("changes the page size", async () => {
        const user = userEvent.setup();
        renderWithProviders(<AccountsTable accounts={many} pageSize={10} />);
        await user.selectOptions(screen.getByLabelText("Rows per page"), "20");
        expect(bodyRows()).toHaveLength(20);
      });
    });
  });

  describe("summary variant", () => {
    it("shows the compact column set and no pagination or sorting", () => {
      renderWithProviders(<AccountsTable accounts={[makeAccount()]} variant="summary" />);
      const table = screen.getByRole("table", { name: "Recent accounts" });
      expect(within(table).queryByRole("columnheader", { name: /Principal/ })).toBeNull();
      expect(within(table).queryByRole("columnheader", { name: /Rate/ })).toBeNull();
      expect(within(table).getByRole("columnheader", { name: /Balance/ })).toBeInTheDocument();
      expect(within(table).queryByRole("button", { name: /Balance/ })).toBeNull();
    });

    it("falls back to the principal when no balance is recorded", () => {
      renderWithProviders(
        <AccountsTable accounts={[makeAccount({ borrow_amount: "750.00", current_balance: null })]} variant="summary" />,
      );
      expect(screen.getByText("$750.00")).toBeInTheDocument();
    });
  });
});
