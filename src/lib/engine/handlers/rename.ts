import { renameEntry } from "@/lib/files/operations";
import { EngineExecutionError } from "../errors";
import { ensurePermission } from "../permissions";
import type { CommandHandler, RenameParams } from "../types";

export const renameHandler: CommandHandler<RenameParams, { name: string }> = {
  type: "rename",
  sideEffect: true,
  validate(p) {
    if (!p?.parent || !p?.entry)
      return { ok: false, code: "INVALID_PARAMS", message: "Élément manquant" };
    const clean = p.newName?.trim();
    if (!clean) return { ok: false, code: "INVALID_PARAMS", message: "Nom vide" };
    if (/[\\/]/.test(clean))
      return {
        ok: false,
        code: "INVALID_PARAMS",
        message: "Le nom ne peut pas contenir « / » ou « \\ »",
      };
    return { ok: true };
  },
  async run(p) {
    await ensurePermission("storage.write");
    const res = await renameEntry(p.parent, p.entry, p.newName);
    if (!res.ok) {
      const msg = res.error ?? "Renommage impossible";
      const code = /existe/i.test(msg) ? "CONFLICT" : "EXECUTION_FAILED";
      throw new EngineExecutionError(code, msg);
    }
    return { name: p.newName.trim() };
  },
};
