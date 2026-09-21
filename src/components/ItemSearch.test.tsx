import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ItemSearch } from "./ItemSearch";

vi.mock("@/lib/api", () => ({ getItemVariations: () => Promise.resolve([]) }));

beforeAll(() => {
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});

function renderSearch(onChange: (...args: unknown[]) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ItemSearch items={[]} value="" onChange={onChange} allowCustom />
    </QueryClientProvider>,
  );
}

describe("ItemSearch custom names", () => {
  // The name lived only in this box until a click elsewhere committed it.
  // Switching tab or app fires no click, so it used to be lost on return.
  it("keeps a typed name when the tab is hidden", () => {
    const onChange = vi.fn();
    renderSearch(onChange);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Custom cable" } });
    expect(onChange).not.toHaveBeenCalled();  // not on every keystroke — that lagged

    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    fireEvent(document, new Event("visibilitychange"));
    expect(onChange).toHaveBeenCalledWith("", null, "Custom cable", null);
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  it("keeps a typed name when focus leaves the box", () => {
    const onChange = vi.fn();
    renderSearch(onChange);
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "Delivery fee" } });
    fireEvent.blur(box);
    expect(onChange).toHaveBeenCalledWith("", null, "Delivery fee", null);
  });

  it("commits nothing when the box is empty", () => {
    const onChange = vi.fn();
    renderSearch(onChange);
    fireEvent.blur(screen.getByRole("textbox"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
