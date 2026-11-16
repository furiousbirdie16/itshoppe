import { describe, expect, it, vi, afterEach } from "vitest";
import { act, fireEvent, render } from "@testing-library/react";
import { TOUCH_HOLD_MS, useDragReorder } from "./use-drag-reorder";

function List({ onMove }: { onMove: (from: number, to: number) => void }) {
  const drag = useDragReorder(onMove);
  return (
    <div>
      {["a", "b", "c"].map((x, i) => (
        <div key={x} {...drag.rowProps(i)} className={drag.rowClass(i)} data-testid={`row-${i}`}>
          <span {...drag.handleProps(i)} data-testid={`handle-${i}`}>grip</span>
          {x}
        </div>
      ))}
    </div>
  );
}

// jsdom has no PointerEvent, so fireEvent would drop pointerType and the
// coordinates. A MouseEvent carrying the pointer fields stands in for it.
if (typeof window.PointerEvent === "undefined") {
  class FakePointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  (window as any).PointerEvent = FakePointerEvent;
}

const pointAt = (el: Element) => {
  (document as any).elementFromPoint = vi.fn(() => el);
};

describe("useDragReorder", () => {
  afterEach(() => { delete (document as any).elementFromPoint; });

  it("moves the dragged row to where it is dropped", () => {
    const onMove = vi.fn();
    const { getByTestId } = render(<List onMove={onMove} />);
    fireEvent.pointerDown(getByTestId("handle-0"), { button: 0, pointerId: 1 });
    pointAt(getByTestId("row-2"));
    fireEvent.pointerMove(getByTestId("handle-0"), { pointerId: 1, clientX: 5, clientY: 5 });
    expect(getByTestId("row-0").className).toContain("opacity-50");
    fireEvent.pointerUp(getByTestId("handle-0"), { pointerId: 1 });
    expect(onMove).toHaveBeenCalledWith(0, 2);
    expect(getByTestId("row-0").className).not.toContain("opacity-50");
  });

  it("does nothing when dropped where it started", () => {
    const onMove = vi.fn();
    const { getByTestId } = render(<List onMove={onMove} />);
    fireEvent.pointerDown(getByTestId("handle-1"), { button: 0, pointerId: 1 });
    fireEvent.pointerUp(getByTestId("handle-1"), { pointerId: 1 });
    expect(onMove).not.toHaveBeenCalled();
  });

  it("drops nothing when the drag is cancelled", () => {
    const onMove = vi.fn();
    const { getByTestId } = render(<List onMove={onMove} />);
    fireEvent.pointerDown(getByTestId("handle-0"), { button: 0, pointerId: 1 });
    pointAt(getByTestId("row-1"));
    fireEvent.pointerMove(getByTestId("handle-0"), { pointerId: 1 });
    fireEvent.pointerCancel(getByTestId("handle-0"), { pointerId: 1 });
    fireEvent.pointerUp(getByTestId("handle-0"), { pointerId: 1 });
    expect(onMove).not.toHaveBeenCalled();
  });

  describe("on a touch screen", () => {
    afterEach(() => { vi.useRealTimers(); });

    it("lifts the row only after the grip is held", () => {
      vi.useFakeTimers();
      const onMove = vi.fn();
      const { getByTestId } = render(<List onMove={onMove} />);
      fireEvent.pointerDown(getByTestId("handle-0"), { button: 0, pointerId: 1, pointerType: "touch", clientX: 5, clientY: 5 });
      expect(getByTestId("row-0").className).not.toContain("opacity-50");
      act(() => { vi.advanceTimersByTime(TOUCH_HOLD_MS); });
      expect(getByTestId("row-0").className).toContain("opacity-50");
      pointAt(getByTestId("row-2"));
      fireEvent.pointerMove(getByTestId("handle-0"), { pointerId: 1, pointerType: "touch", clientX: 5, clientY: 5 });
      fireEvent.pointerUp(getByTestId("handle-0"), { pointerId: 1, pointerType: "touch" });
      expect(onMove).toHaveBeenCalledWith(0, 2);
    });

    it("treats a finger that moves straight away as a scroll", () => {
      vi.useFakeTimers();
      const onMove = vi.fn();
      const { getByTestId } = render(<List onMove={onMove} />);
      fireEvent.pointerDown(getByTestId("handle-0"), { button: 0, pointerId: 1, pointerType: "touch", clientX: 5, clientY: 5 });
      pointAt(getByTestId("row-2"));
      fireEvent.pointerMove(getByTestId("handle-0"), { pointerId: 1, pointerType: "touch", clientX: 5, clientY: 60 });
      act(() => { vi.advanceTimersByTime(TOUCH_HOLD_MS * 2); });
      expect(getByTestId("row-0").className).not.toContain("opacity-50");
      fireEvent.pointerUp(getByTestId("handle-0"), { pointerId: 1, pointerType: "touch" });
      expect(onMove).not.toHaveBeenCalled();
    });

    it("drops nothing when the browser takes the touch for a scroll", () => {
      vi.useFakeTimers();
      const onMove = vi.fn();
      const { getByTestId } = render(<List onMove={onMove} />);
      fireEvent.pointerDown(getByTestId("handle-1"), { button: 0, pointerId: 1, pointerType: "touch", clientX: 5, clientY: 5 });
      fireEvent.pointerCancel(getByTestId("handle-1"), { pointerId: 1, pointerType: "touch" });
      act(() => { vi.advanceTimersByTime(TOUCH_HOLD_MS * 2); });
      expect(getByTestId("row-1").className).not.toContain("opacity-50");
      expect(onMove).not.toHaveBeenCalled();
    });
  });
});
