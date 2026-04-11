// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InviteLandingPage } from "./InviteLanding";

const getInviteMock = vi.hoisted(() => vi.fn());
const acceptInviteMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const signInEmailMock = vi.hoisted(() => vi.fn());
const signUpEmailMock = vi.hoisted(() => vi.fn());
const healthGetMock = vi.hoisted(() => vi.fn());

vi.mock("../api/access", () => ({
  accessApi: {
    getInvite: (token: string) => getInviteMock(token),
    acceptInvite: (token: string, input: unknown) => acceptInviteMock(token, input),
  },
}));

vi.mock("../api/auth", () => ({
  authApi: {
    getSession: () => getSessionMock(),
    signInEmail: (input: unknown) => signInEmailMock(input),
    signUpEmail: (input: unknown) => signUpEmailMock(input),
  },
}));

vi.mock("../api/health", () => ({
  healthApi: {
    get: () => healthGetMock(),
  },
}));

vi.mock("@/context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompany: null,
    selectedCompanyId: null,
    companies: [],
    selectionSource: "manual",
    loading: false,
    error: null,
    setSelectedCompanyId: vi.fn(),
    reloadCompanies: vi.fn(),
    createCompany: vi.fn(),
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

describe("InviteLandingPage", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    localStorage.clear();
    container = document.createElement("div");
    document.body.appendChild(container);
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({
        fillStyle: "",
        fillRect: vi.fn(),
        beginPath: vi.fn(),
        arc: vi.fn(),
        fill: vi.fn(),
      })),
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "toDataURL", {
      configurable: true,
      value: vi.fn(() => "data:image/png;base64,stub"),
    });

    getInviteMock.mockResolvedValue({
      id: "invite-1",
      companyId: "company-1",
      companyName: "Acme Robotics",
      companyLogoUrl: "/api/assets/logo-1/content",
      companyBrandColor: "#114488",
      inviteType: "company_join",
      allowedJoinTypes: "both",
      humanRole: "operator",
      expiresAt: "2027-03-07T00:10:00.000Z",
      inviteMessage: "Welcome aboard.",
    });
    acceptInviteMock.mockReset();
    healthGetMock.mockResolvedValue({
      status: "ok",
      deploymentMode: "authenticated",
    });
    getSessionMock.mockResolvedValue(null);
    signInEmailMock.mockResolvedValue(undefined);
    signUpEmailMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    container.remove();
    document.body.innerHTML = "";
    vi.clearAllMocks();
  });

  it("keeps account signup inline and remembers the invite token while signing in", async () => {
    getSessionMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        session: { id: "session-1", userId: "user-1" },
        user: {
          id: "user-1",
          name: "Jane Example",
          email: "jane@example.com",
          image: null,
        },
      });

    const root = createRoot(container);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/invite/pcp_invite_test"]}>
          <QueryClientProvider client={queryClient}>
            <Routes>
              <Route path="/invite/:token" element={<InviteLandingPage />} />
            </Routes>
          </QueryClientProvider>
        </MemoryRouter>,
      );
    });
    await flushReact();
    await flushReact();

    expect(container.textContent).toContain("Join Acme Robotics");
    expect(container.textContent).toContain("Personal access");
    expect(container.textContent).toContain("Create account");
    expect(container.textContent).not.toContain("Join as human");
    expect(container.querySelector('[data-testid="invite-inline-auth"]')).not.toBeNull();
    expect(localStorage.getItem("paperclip:pending-invite-token")).toBe("pcp_invite_test");
    expect(container.querySelector('img[alt="Acme Robotics logo"]')).not.toBeNull();

    const emailInput = container.querySelector('input[name="email"]') as HTMLInputElement | null;
    const passwordInput = container.querySelector('input[name="password"]') as HTMLInputElement | null;
    expect(emailInput).not.toBeNull();
    expect(passwordInput).not.toBeNull();
    const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    expect(inputValueSetter).toBeTypeOf("function");

    await act(async () => {
      inputValueSetter!.call(emailInput, "jane@example.com");
      emailInput!.dispatchEvent(new Event("input", { bubbles: true }));
      emailInput!.dispatchEvent(new Event("change", { bubbles: true }));
      inputValueSetter!.call(passwordInput, "supersecret");
      passwordInput!.dispatchEvent(new Event("input", { bubbles: true }));
      passwordInput!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const authForm = container.querySelector('[data-testid="invite-inline-auth"] form') as HTMLFormElement | null;
    expect(authForm).not.toBeNull();

    await act(async () => {
      authForm?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await flushReact();
    await flushReact();
    await flushReact();

    expect(signInEmailMock).toHaveBeenCalledWith({
      email: "jane@example.com",
      password: "supersecret",
    });
    expect(getSessionMock).toHaveBeenCalled();
    expect(localStorage.getItem("paperclip:pending-invite-token")).toBe("pcp_invite_test");

    await act(async () => {
      root.unmount();
    });
  });
});
