// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const transport = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("juava", async original => ({ ...(await original<typeof import("juava")>()), rpc: transport.rpc }));
vi.mock("../../lib/context", () => ({ useWorkspace: () => ({ id: "ws" }) }));
const { useEntitlements } = await import("../../lib/entitlements");
afterEach(cleanup);
function mount() {
  const client = new QueryClient({ logger: { log: () => {}, warn: () => {}, error: () => {} } });
  return renderHook(useEntitlements, {
    wrapper: ({ children }: any) => React.createElement(QueryClientProvider, { client }, children),
  });
}
describe("the real entitlement hook and query", () => {
  it("keeps loading unknown then consumes a denial", async () => {
    let finish!: (value: any) => void;
    transport.rpc.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const { result } = mount();
    expect(result.current.loading).toBe(true);
    expect(result.current.customDomains).toBeNull();
    await act(async () => {
      finish({ customDomains: false, identityStitching: false });
    });
    await waitFor(() => expect(result.current.customDomains).toBe(false));
  });
  it("keeps errors unknown and retries to a partial grant", async () => {
    transport.rpc.mockRejectedValueOnce(new Error("offline"));
    const { result } = mount();
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.customDomains).toBeNull();
    transport.rpc.mockResolvedValueOnce({ customDomains: true, identityStitching: null });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.customDomains).toBe(true));
    expect(result.current.identityStitching).toBeNull();
    expect(result.current.failed).toBe(false);
  });
});
