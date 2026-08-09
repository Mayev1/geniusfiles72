import { shareEntries } from "@/lib/files/operations";
import { EngineExecutionError } from "../errors";
import { ensurePermission } from "../permissions";
import type { CommandHandler, ShareParams } from "../types";

export const shareHandler: CommandHandler<ShareParams, { shared: number }> = {
  type: "share",
  sideEffect: true,
  validate(p) {
    if (!p?.parent || !Array.isArray(p.entries) || p.entries.length === 0)
      return { ok: false, code: "INVALID_PARAMS", message: "Aucun fichier à partager" };
    return { ok: true };
  },
  async run(p) {
    await ensurePermission("storage.read");
    const files = p.entries.filter((e) => !e.isDirectory);
    const res = await shareEntries(p.parent, files);
    if (!res.ok)
      throw new EngineExecutionError("EXECUTION_FAILED", res.error ?? "Partage impossible");
    return { shared: files.length };
  },
};
