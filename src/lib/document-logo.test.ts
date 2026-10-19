import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { fitLogo } from "./document-logo";

describe("fitLogo", () => {
  it("limits a wide logo by the width", () => {
    expect(fitLogo(600, 200, 30, 14)).toEqual({ w: 30, h: 10 });
  });
  it("limits a tall or square logo by the height", () => {
    expect(fitLogo(300, 300, 30, 14)).toEqual({ w: 14, h: 14 });
  });
  it("falls back to a square when the size is unknown", () => {
    expect(fitLogo(0, 0, 30, 14)).toEqual({ w: 14, h: 14 });
  });
});
