import { create } from "zustand";
import { persist } from "zustand/middleware";
import { explorerTx, HIDEKI_CHAIN_ID, SDK_VERSION } from "@/lib/freshness";

export type PaperPos = {
  id: string;
  marketId: string;
  symbol: string;
  base: string;
  isLong: boolean;
  qty: number;
  entry: number;
  leverage: number;
  notional: number;
  openedAt: number;
};

export type EvidenceStatus =
  | "prepared"
  | "signature"
  | "submitted"
  | "pending"
  | "confirmed"
  | "failed"
  | "rejected"
  | "pasted"
  | "unknown";

export type Evidence = {
  id: string;
  tx: string;
  status: EvidenceStatus;
  symbol: string;
  side: "long" | "short";
  quantity: string;
  price: string;
  orderType: "limit" | "ioc";
  wallet: string;
  owner?: string;
  signer?: string;
  explorer: string;
  at: number;
  sdkVersion: string;
  chainId: number;
  note: string;
};

export type CheckKey =
  | "whitelist"
  | "github"
  | "readme"
  | "realOrder"
  | "txRecorded"
  | "video"
  | "posts"
  | "postLinks"
  | "feedback"
  | "submitted";

export type Checklist = Record<CheckKey, boolean>;

export type FeedbackKind = "confirmed" | "possible" | "markside";

export type FeedbackDraft = {
  id: string;
  title: string;
  severity: "critical" | "major" | "normal";
  area: "API" | "SDK" | "docs" | "app" | "contracts";
  kind: FeedbackKind;
  security: boolean;
  summary: string;
  steps: string;
  expected: string;
  actual: string;
  evidence: string;
  wallet: string;
  browser: string;
  at: number;
};

const emptyChecks = (): Checklist => ({
  whitelist: false,
  github: false,
  readme: false,
  realOrder: false,
  txRecorded: false,
  video: false,
  posts: false,
  postLinks: false,
  feedback: false,
  submitted: false,
});

type DeskState = {
  marketId: string | null;
  setMarketId: (id: string) => void;
  notional: number;
  setNotional: (n: number) => void;
  leverage: number;
  setLeverage: (n: number) => void;
  isLong: boolean;
  setIsLong: (v: boolean) => void;
  maker: boolean;
  setMaker: (v: boolean) => void;
  stop: string;
  setStop: (v: string) => void;
  target: string;
  setTarget: (v: string) => void;
  mode: "paper" | "live";
  setMode: (m: "paper" | "live") => void;
  positions: PaperPos[];
  openPaper: (p: Omit<PaperPos, "id" | "openedAt">) => void;
  closePaper: (id: string) => void;
  account: string;
  setAccount: (a: string) => void;
  botOwner: string;
  setBotOwner: (a: string) => void;
  evidence: Evidence[];
  addEvidence: (e: Omit<Evidence, "id" | "at"> & { at?: number }) => string;
  updateEvidence: (id: string, patch: Partial<Omit<Evidence, "id">>) => void;
  removeEvidence: (id: string) => void;
  checklist: Checklist;
  toggleCheck: (k: CheckKey) => void;
  feedback: FeedbackDraft[];
  saveFeedback: (d: FeedbackDraft) => void;
  removeFeedback: (id: string) => void;
};

export const useDesk = create<DeskState>()(
  persist(
    (set) => ({
      marketId: null,
      setMarketId: (marketId) => set({ marketId }),
      notional: 50,
      setNotional: (notional) => set({ notional }),
      leverage: 2,
      setLeverage: (leverage) => set({ leverage }),
      isLong: false,
      setIsLong: (isLong) => set({ isLong }),
      maker: true,
      setMaker: (maker) => set({ maker }),
      stop: "",
      setStop: (stop) => set({ stop }),
      target: "",
      setTarget: (target) => set({ target }),
      mode: "paper",
      setMode: (mode) => set({ mode }),
      positions: [],
      openPaper: (p) =>
        set((s) => ({
          positions: [{ ...p, id: `${p.marketId}-${Date.now()}`, openedAt: Date.now() }, ...s.positions].slice(0, 24),
        })),
      closePaper: (id) => set((s) => ({ positions: s.positions.filter((p) => p.id !== id) })),
      account: "",
      setAccount: (account) => set({ account }),
      botOwner: "",
      setBotOwner: (botOwner) => set({ botOwner }),
      evidence: [],
      addEvidence: (e) => {
        const id = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
        set((s) => ({
          evidence: [{ ...e, id, at: e.at ?? Date.now() }, ...s.evidence].slice(0, 40),
        }));
        return id;
      },
      updateEvidence: (id, patch) =>
        set((s) => ({
          evidence: s.evidence.map((row) => (row.id === id ? { ...row, ...patch, id: row.id } : row)),
        })),
      removeEvidence: (id) => set((s) => ({ evidence: s.evidence.filter((e) => e.id !== id) })),
      checklist: emptyChecks(),
      toggleCheck: (k) => set((s) => ({ checklist: { ...s.checklist, [k]: !s.checklist[k] } })),
      feedback: [],
      saveFeedback: (d) =>
        set((s) => ({
          feedback: [d, ...s.feedback.filter((f) => f.id !== d.id)].slice(0, 30),
        })),
      removeFeedback: (id) => set((s) => ({ feedback: s.feedback.filter((f) => f.id !== id) })),
    }),
    { name: "markside-desk-v2", skipHydration: true },
  ),
);

export function migrateLegacyDesk() {
  if (typeof localStorage === "undefined") return;
  const current = useDesk.getState();
  if (current.positions.length || current.evidence.length || current.account) return;
  try {
    const raw = localStorage.getItem("markside-desk");
    if (!raw) return;
    const parsed = JSON.parse(raw) as {
      state?: {
        positions?: PaperPos[];
        account?: string;
        evidence?: { id?: string; tx?: string; symbol?: string; note?: string; at?: number }[];
      };
    };
    const old = parsed.state;
    if (!old) return;
    const evidence: Evidence[] = (old.evidence ?? [])
      .filter((e) => e.tx && /^0x[a-fA-F0-9]{64}$/.test(e.tx))
      .map((e) => ({
        id: e.id ?? String(e.at ?? Date.now()),
        tx: e.tx as string,
        status: "pasted",
        symbol: e.symbol ?? "",
        side: "long",
        quantity: "",
        price: "",
        orderType: "limit",
        wallet: "",
        explorer: explorerTx(e.tx as string),
        at: e.at ?? Date.now(),
        sdkVersion: SDK_VERSION,
        chainId: HIDEKI_CHAIN_ID,
        note: e.note || "Imported from the earlier locker. Status is pasted, not confirmed.",
      }));
    useDesk.setState({
      positions: old.positions ?? [],
      account: old.account ?? "",
      evidence,
    });
  } catch {
    /* ignore a corrupt older blob */
  }
}
