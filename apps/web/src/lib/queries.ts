"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { normalizeBackends } from "@/lib/backends";
import { PAIRING_CODE_MINUTES, type Look, type SettingsPatch } from "@/lib/types";

export const qk = {
  backends: ["backends"] as const,
  venues: ["venues"] as const,
  venue: (id: string) => ["venue", id] as const,
  space: (id: string) => ["space", id] as const,
  looks: (spaceId: string) => ["looks", spaceId] as const,
  look: (id: string) => ["look", id] as const,
  chat: (spaceId: string) => ["chat", spaceId] as const,
  job: (id: string) => ["job", id] as const,
  defaultSpec: ["default-spec"] as const,
  settings: ["settings"] as const,
  setup: ["setup"] as const,
  lan: ["lan"] as const,
  lanDevices: ["lan", "devices"] as const,
};

export function useBackends() {
  return useQuery({ queryKey: qk.backends, queryFn: async () => normalizeBackends(await api.backends()), staleTime: 30_000, retry: 1 });
}

export function useVenues() {
  return useQuery({ queryKey: qk.venues, queryFn: api.listVenues });
}

export function useVenue(id: string | undefined) {
  return useQuery({ queryKey: qk.venue(id ?? ""), queryFn: () => api.getVenue(id!), enabled: Boolean(id) });
}

export function useSpace(id: string | undefined) {
  return useQuery({ queryKey: qk.space(id ?? ""), queryFn: () => api.getSpace(id!), enabled: Boolean(id) });
}

const pending = (look: Look | undefined) =>
  Boolean(look?.renders.some((r) => r.status === "queued" || r.status === "running"));

export function useLooks(spaceId: string | undefined) {
  return useQuery({
    queryKey: qk.looks(spaceId ?? ""),
    queryFn: () => api.listLooks(spaceId!),
    enabled: Boolean(spaceId),
    refetchInterval: (q) => (q.state.data?.some(pending) ? 3000 : false),
  });
}

export function useLook(id: string | null | undefined) {
  return useQuery({
    queryKey: qk.look(id ?? ""),
    queryFn: () => api.getLook(id!),
    enabled: Boolean(id),
    refetchInterval: (q) => (pending(q.state.data) ? 1500 : false),
  });
}

export function useChatHistory(spaceId: string) {
  return useQuery({ queryKey: qk.chat(spaceId), queryFn: () => api.chatHistory(spaceId), staleTime: Infinity });
}

export function useDefaultSpec() {
  return useQuery({ queryKey: qk.defaultSpec, queryFn: api.defaultSpec, staleTime: Infinity, retry: 0 });
}

export function useSettings() {
  return useQuery({ queryKey: qk.settings, queryFn: api.getSettings });
}

/** Whether first-run setup is done (`GET /api/system/setup`). */
export function useSetupStatus() {
  return useQuery({ queryKey: qk.setup, queryFn: api.setupStatus, staleTime: 30_000, retry: 1 });
}

/**
 * `GET /api/system/lan`. Every fetch issues a new one-time pairing code and retires the last, so it only refetches on
 * purpose (New code), when the code expires, or when Setup is opened again; never on window focus.
 */
export function useLanInfo() {
  return useQuery({
    queryKey: qk.lan,
    queryFn: api.lanInfo,
    staleTime: Infinity,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: (q) => (q.state.data?.enabled ? PAIRING_CODE_MINUTES * 60_000 : false),
    retry: 1,
  });
}

/** Paired phones; polled while phone access is on so a phone that just paired shows up. */
export function useLanDevices(poll: boolean) {
  return useQuery({ queryKey: qk.lanDevices, queryFn: api.lanDevices, refetchInterval: poll ? 5000 : false });
}

export function useForgetLanDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.forgetLanDevice(id),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.lanDevices }),
  });
}

export function useForgetAllLanDevices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.forgetAllLanDevices(),
    onSettled: () => qc.invalidateQueries({ queryKey: qk.lanDevices }),
  });
}

/** Check again: re-detects the AI tools now, without restarting the API. */
export function useRefreshBackends() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => normalizeBackends(await api.refreshBackends()),
    onSuccess: (data) => {
      qc.setQueryData(qk.backends, data);
      void qc.invalidateQueries({ queryKey: qk.setup });
    },
  });
}

export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: SettingsPatch) => api.updateSettings(patch),
    onSuccess: (settings) => {
      qc.setQueryData(qk.settings, settings);
      // Defaults feed the backends' defaults and setup status. (Phone access is read-only; see `make dev-lan`.)
      void qc.invalidateQueries({ queryKey: qk.backends });
      void qc.invalidateQueries({ queryKey: qk.setup });
    },
  });
}
