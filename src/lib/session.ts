import { create } from "zustand";

type Session = {
  address: string | null;
  chainId: number | null;
  connectError: string | null;
  setSession: (s: { address: string | null; chainId: number | null }) => void;
  setConnectError: (e: string | null) => void;
};

export const useSession = create<Session>((set) => ({
  address: null,
  chainId: null,
  connectError: null,
  setSession: ({ address, chainId }) => set({ address, chainId, connectError: null }),
  setConnectError: (connectError) => set({ connectError }),
}));
