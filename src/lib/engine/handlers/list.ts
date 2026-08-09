import { listDirectory } from "@/lib/files/fs";
import type { FileEntry } from "@/lib/files/types";
import { EngineExecutionError } from "../errors";
import { ensurePermission } from "../permissions";
import type { CommandHandler, ListParams } from "../types";

export const listHandler: CommandHandler<ListParams, { entries: FileEntry[] }> = {
  type: "list",
  sideEffect: false,
  validate(params) {
    if (!params?.path) return { ok: false, code: "INVALID_PARAMS", message: "Chemin manquant" };
    return { ok: true };
  },
  async run(params) {
    await ensurePermission("storage.read");
    const res = await listDirectory(params.path);
    if (!res.ok) {
      if (res.reason === "denied")
        throw new EngineExecutionError("PERMISSION_DENIED", res.message ?? "Accès refusé");
      if (res.reason === "unavailable")
        throw new EngineExecutionError("UNAVAILABLE", res.message ?? "Emplacement indisponible");
      throw new EngineExecutionError("EXECUTION_FAILED", res.message ?? "Lecture impossible");
    }
    return { entries: res.entries };
  },
};
