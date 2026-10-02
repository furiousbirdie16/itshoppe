import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PaymentVarianceNote } from "./PaymentVarianceNote";

vi.mock("@/lib/api", () => ({ setPaymentVarianceNote: vi.fn() }));

function show(props: Partial<React.ComponentProps<typeof PaymentVarianceNote>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PaymentVarianceNote
        invoiceId="inv-1"
        total={10000}
        received={12000}
        note=""
        onSaved={() => {}}
        {...props}
      />
    </QueryClientProvider>,
  );
}

describe("PaymentVarianceNote", () => {
  it("says how much came in over, and what was invoiced against it", () => {
    show();
    expect(screen.getByText(/over/)).toBeTruthy();
    expect(screen.getByText(/₱2,000\.00/)).toBeTruthy();
    expect(screen.getByText(/invoiced ₱10,000\.00, received ₱12,000\.00/)).toBeTruthy();
  });

  it("says short when less arrived than was invoiced", () => {
    show({ received: 9000 });
    expect(screen.getByText(/short/)).toBeTruthy();
    expect(screen.getByText(/₱1,000\.00/)).toBeTruthy();
  });

  // Nothing to explain, so nothing to show — otherwise every invoice settled to
  // the penny would carry an empty prompt.
  it("shows nothing when the money matches the invoice", () => {
    const { container } = show({ received: 10000 });
    expect(container.textContent).toBe("");
  });

  // Rounding in a currency column should not look like a discrepancy.
  it("ignores a difference smaller than half a centavo", () => {
    const { container } = show({ received: 10000.004 });
    expect(container.textContent).toBe("");
  });

  it("asks for a reason when none has been recorded", () => {
    show();
    expect(screen.getByText(/No reason recorded/)).toBeTruthy();
  });

  it("shows the reason once one exists", () => {
    show({ note: "Settles invoice 1180" });
    expect(screen.getByText("Settles invoice 1180")).toBeTruthy();
    expect(screen.queryByText(/No reason recorded/)).toBeNull();
  });
});
