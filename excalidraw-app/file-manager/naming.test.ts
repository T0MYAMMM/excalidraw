import { defaultDrawingName, relativeTime, uniqueName } from "./naming";

describe("file-manager naming", () => {
  it("builds a file-safe default name", () => {
    expect(defaultDrawingName(new Date(2026, 10, 9, 7, 5))).toBe(
      "Drawing 2026-11-09 07.05",
    );
  });

  it("picks the first free numbered name", () => {
    expect(uniqueName("Plan", [])).toBe("Plan");
    expect(uniqueName("Plan", ["Plan"])).toBe("Plan (2)");
    expect(uniqueName("Plan", ["Plan", "Plan (2)", "Plan (3)"])).toBe(
      "Plan (4)",
    );
  });

  it("formats relative times", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    expect(relativeTime("2026-11-19T11:59:30Z", now)).toBe("just now");
    expect(relativeTime("2026-11-19T11:45:00Z", now)).toBe("15 min ago");
    expect(relativeTime("2026-11-19T09:00:00Z", now)).toBe("3 h ago");
    expect(relativeTime("2026-11-17T12:00:00Z", now)).toBe("2 d ago");
  });
});
