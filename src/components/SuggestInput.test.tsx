import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SuggestInput } from "./SuggestInput";

function optionValues(container: HTMLElement) {
  return [...container.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"));
}

describe("SuggestInput", () => {
  it("offers each previously used value once, sorted, ignoring blanks and case", () => {
    const { container } = render(
      <SuggestInput
        value=""
        onChange={() => {}}
        options={["Fuel", "  ", "advertisement", "fuel", "", "Supplies", "Fuel "]}
      />,
    );
    expect(optionValues(container)).toEqual(["advertisement", "Fuel", "Supplies"]);
  });

  it("still accepts a value that is not in the list", () => {
    const onChange = vi.fn();
    render(<SuggestInput value="" onChange={onChange} options={["Fuel"]} />);

    // Still a free-text field — a brand new category must not be harder to enter
    // than an existing one. (An input with `list` reports as a combobox.)
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "Advertisement" } });
    expect(onChange).toHaveBeenCalledWith("Advertisement");
  });

  it("omits the list entirely when nothing has been entered before", () => {
    const { container } = render(<SuggestInput value="" onChange={() => {}} options={["", "   "]} />);
    expect(container.querySelector("datalist")).toBeNull();
    expect(screen.getByRole("textbox")).not.toHaveAttribute("list");
  });
});
