// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Button, Form } from "antd";
import { ScheduleEditor } from "../../components/ReverseETL/ScheduleEditor";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addListener() {}, removeListener() {} }))
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(schedule: string, disabled = false) {
  const save = vi.fn();
  render(
    React.createElement(
      Form,
      { initialValues: { schedule }, onFinish: save, disabled },
      React.createElement(Form.Item, { name: "schedule" }, React.createElement(ScheduleEditor)),
      React.createElement(Button, { htmlType: "submit" }, "Save settings")
    )
  );
  return save;
}

function choose(label: string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: "Schedule frequency" }));
  fireEvent.click(screen.getByTitle(label));
}

describe("Reverse ETL schedule editor", () => {
  it.each([
    ["Manual only", ""],
    ["Every hour", "0 * * * *"],
    ["Every 6 hours", "0 */6 * * *"],
    ["Daily at midnight", "0 0 * * *"],
  ])("replaces a saved custom schedule with %s", async (label, expected) => {
    const save = mount("15 9 * * 1-5");
    expect((screen.getByRole("textbox", { name: "Cron schedule" }) as HTMLInputElement).value).toBe("15 9 * * 1-5");
    choose(label);
    expect(screen.queryByRole("textbox", { name: "Cron schedule" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ schedule: expected }));
  });

  it("saves custom cron without sending the selector's custom sentinel", async () => {
    const save = mount("");
    choose("Custom cron expression");
    fireEvent.change(screen.getByRole("textbox", { name: "Cron schedule" }), { target: { value: "30 8 * * 1-5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ schedule: "30 8 * * 1-5" }));
  });

  it("inherits disabled form state for both preset and custom controls", () => {
    mount("15 9 * * 1-5", true);
    expect((screen.getByRole("combobox", { name: "Schedule frequency" }) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByRole("textbox", { name: "Cron schedule" }) as HTMLInputElement).disabled).toBe(true);
  });
});
