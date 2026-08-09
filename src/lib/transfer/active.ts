/**
 * Active transfers — singleton module-level store keeping the running
 * send/receive session alive when the user navigates away from
 * `/transfert`. The native side (Kotlin plugin) already continues the
 * TCP transfer regardless of the React lifecycle; without this store
 * the *UI state* (current step, live progress) was recreated fresh on
 * every route mount and looked like "the transfer was lost".
 *
 * Two independent slots (`send`, `receive`) so a device can host and
 * receive simultaneously in theory. Each slot owns the current step
 * machine used by `transfert.tsx`, plus the `RunningTransfer` handle.
 *
 * The engine's `onUpdate` callback should route through
 * `patchActiveSession` so subscribers re-render with the latest
 * progress even when the originating screen is unmounted.
 */
import type { HistoryEntry } from "./types";
import type { RunningTransfer } from "./engine";
import type { TransferSession } from "./types";
import type { OutgoingSession } from "./session";
import type { IncomingSessionInvite } from "./session";
import { useSyncExternalStore } from "react";

export type SendStep =
  | { kind: "intro" }
  | { kind: "picker" }
  | {
      kind: "hosting";
      outgoing: OutgoingSession;
      handle: RunningTransfer;
      session: TransferSession;
    }
  | { kind: "summary"; entry: HistoryEntry };

export type ReceiveStep =
  | { kind: "intro" }
  | { kind: "scan" }
  | { kind: "code" }
  | { kind: "search" }
  | { kind: "invite"; invite: IncomingSessionInvite }
  | {
      kind: "progress";
      handle: RunningTransfer;
      session: TransferSession;
    }
  | { kind: "summary"; entry: HistoryEntry };

let sendStep: SendStep = { kind: "intro" };
let receiveStep: ReceiveStep = { kind: "intro" };
const subs = new Set<() => void>();

function emit() {
  for (const fn of subs) fn();
}

export function getSendStep(): SendStep {
  return sendStep;
}
export function setSendStep(next: SendStep | ((prev: SendStep) => SendStep)) {
  sendStep = typeof next === "function" ? (next as (p: SendStep) => SendStep)(sendStep) : next;
  emit();
}
export function patchHostingSession(session: TransferSession) {
  if (sendStep.kind === "hosting") {
    sendStep = { ...sendStep, session };
    emit();
  }
}
export function patchHostingOutgoing(next: OutgoingSession) {
  if (sendStep.kind === "hosting") {
    sendStep = { ...sendStep, outgoing: next };
    emit();
  }
}

export function getReceiveStep(): ReceiveStep {
  return receiveStep;
}
export function setReceiveStep(next: ReceiveStep | ((prev: ReceiveStep) => ReceiveStep)) {
  receiveStep =
    typeof next === "function" ? (next as (p: ReceiveStep) => ReceiveStep)(receiveStep) : next;
  emit();
}
export function patchReceiveSession(session: TransferSession) {
  if (receiveStep.kind === "progress") {
    receiveStep = { ...receiveStep, session };
    emit();
  }
}

export function subscribeActive(fn: () => void): () => void {
  subs.add(fn);
  return () => {
    subs.delete(fn);
  };
}

/** True when a live send/receive session is currently running. */
export function hasActiveTransfer(): boolean {
  return sendStep.kind === "hosting" || receiveStep.kind === "progress";
}

export function useSendStep(): SendStep {
  return useSyncExternalStore(subscribeActive, getSendStep, getSendStep);
}
export function useReceiveStep(): ReceiveStep {
  return useSyncExternalStore(subscribeActive, getReceiveStep, getReceiveStep);
}
