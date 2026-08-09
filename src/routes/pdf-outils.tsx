import { createFileRoute } from "@tanstack/react-router";
import {
  Combine,
  Split,
  FilePlus2,
  FileText,
  RotateCw,
  ArrowUpDown,
  Trash2,
  Scissors,
  Minimize2,
  Info,
  Copy as CopyIcon,
  ScanLine,
  ImagePlus,
  FileSignature,
  Search,
  PenLine,
  Droplet,
  Type as TypeIcon,
  Image as ImageIcon,
  Images as ImagesIcon,
  ClipboardList,
  FileInput,
  FileType2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PdfAnnotator, SignaturePad, type AnnotToolbarItem } from "@/components/pdf/PdfAnnotator";
import {
  newId,
  hexToRgb01,
  dataUrlToBytes,
  imageFileToElementPayload,
  type AnnotElement,
  type TextElement,
  type ImageElement,
} from "@/components/pdf/annot";
import {
  listSignatures,
  saveSignature,
  renameSignature,
  deleteSignature,
  isSignatureCanvasBlank,
  trimSignatureCanvas,
  type StoredSignature,
} from "@/lib/pdf/signatures";
import { toast } from "sonner";
import { AppShell } from "@/components/AppShell";
import { EmptyState } from "@/components/ui/EmptyState";
import {
  BottomSheet,
  BottomSheetDefaultsProvider,
  PrimaryButton,
  TextField,
} from "@/components/files/BottomSheet";
import { ProgressDialog } from "@/components/files/ProgressDialog";
import { DestinationPicker } from "@/components/files/DestinationPicker";
import { FileSourcePicker } from "@/components/files/FileSourcePicker";
import { formatSize } from "@/lib/files/format";
import { toAbsolutePath } from "@/lib/files/fs";
import {
  addImageToPdf,
  addTextToPdf,
  compressPdf,
  estimateCompressedSize,
  deletePages,
  duplicatePdf,
  excelToPdf,
  extractPages,
  extractPdfText,
  fillPdfForm,
  filesToPdf,
  imagesToPdf,
  mergePdfs,
  pdfInfo,
  pdfToImages,
  powerpointToPdf,
  readPdfBlobUrl,
  readPdfForm,
  reorderPages,
  rotatePages,
  searchInPdf,
  splitPdf,
  textFileToPdf,
  textToPdf,
  watermarkPdf,
  wordToPdf,
  type CompressionLevel,
  type FormFieldInfo,
  type ImageOverlay,
  type ImageSource,
  type Orientation,
  type PageSize,
  type PdfInfo,
  type Rotation,
  type SearchHit,
  type TextOverlay,
} from "@/lib/pdf/api";
import { resolveTempPath } from "@/lib/pdf/native-io";
import { scanFromCapture } from "@/lib/pdf/scanner";
import { recordPdfOp } from "@/lib/pdf/history";
import { errorMessage } from "@/lib/errors/humanize";
import { nativePlugin } from "@/lib/native/geniusfiles-native";
import type { ProgressEvent as OpProgressEvent } from "@/lib/files/operations";
import { PostCreateActions } from "@/components/pdf/PostCreateActions";
import { useConfirm } from "@/components/common/useConfirm";
import { confirmCopy, progressLabel } from "@/lib/copy";
import { PageThumbGrid, PageCountBadge } from "@/components/pdf/PageThumbGrid";
import { usePdfThumbnails } from "@/components/pdf/usePdfThumbnails";

export const Route = createFileRoute("/pdf-outils")({
  head: () => ({
    meta: [
      { title: "Outils PDF — GeniusFiles" },
      {
        name: "description",
        content:
          "Fusion, division, extraction, rotation, compression et scanner de documents PDF, hors connexion.",
      },
    ],
  }),
  component: PdfToolsPage,
});

/* ---------- Tools registry ---------- */

type ToolId =
  | "images-to-pdf"
  | "scan"
  | "text-to-pdf"
  | "files-to-pdf"
  | "merge"
  | "split"
  | "extract"
  | "delete-pages"
  | "reorder"
  | "rotate"
  | "compress"
  | "watermark"
  | "add-text"
  | "add-image"
  | "signature"
  | "fill-form"
  | "pdf-to-images"
  | "extract-text"
  | "search"
  | "duplicate"
  | "info";

type Tool = {
  id: ToolId;
  label: string;
  desc: string;
  icon: LucideIcon;
  ready: boolean;
  featured?: boolean;
};

/* Raccourcis mis en avant : les 4 usages les plus fréquents. */
const QUICK_TOOLS: Tool[] = [
  {
    id: "images-to-pdf",
    label: "Images",
    desc: "Créer un PDF depuis des photos",
    icon: ImagePlus,
    ready: true,
    featured: true,
  },
  {
    id: "scan",
    label: "Scanner",
    desc: "Capture + amélioration + PDF",
    icon: ScanLine,
    ready: true,
    featured: true,
  },
  {
    id: "merge",
    label: "Fusionner",
    desc: "Assembler plusieurs PDF",
    icon: Combine,
    ready: true,
    featured: true,
  },
  {
    id: "compress",
    label: "Réduire",
    desc: "Compresser un PDF",
    icon: Minimize2,
    ready: true,
    featured: true,
  },
];

/* Modifier & organiser — le groupe le plus utilisé après les raccourcis. */
const EDIT_TOOLS: Tool[] = [
  { id: "merge", label: "Fusionner", desc: "Plusieurs en un", icon: Combine, ready: true },
  {
    id: "split",
    label: "Diviser",
    desc: "En fichiers",
    icon: Split,
    ready: true,
  },
  {
    id: "extract",
    label: "Extraire des pages",
    desc: "Nouveau PDF",
    icon: Scissors,
    ready: true,
  },
  {
    id: "delete-pages",
    label: "Supprimer des pages",
    desc: "Nettoyer le PDF",
    icon: Trash2,
    ready: true,
  },
  {
    id: "reorder",
    label: "Réorganiser",
    desc: "Ordre des pages",
    icon: ArrowUpDown,
    ready: true,
  },
  { id: "rotate", label: "Faire pivoter", desc: "Rotation par page", icon: RotateCw, ready: true },
  { id: "compress", label: "Compresser", desc: "Réduire la taille", icon: Minimize2, ready: true },
];

/* Créer & convertir. */
const CREATE_TOOLS: Tool[] = [
  {
    id: "images-to-pdf",
    label: "Images → PDF",
    desc: "Depuis des photos",
    icon: ImagePlus,
    ready: true,
  },
  {
    id: "scan",
    label: "Scanner",
    desc: "Capture + retouche",
    icon: ScanLine,
    ready: true,
  },
  {
    id: "text-to-pdf",
    label: "Texte → PDF",
    desc: "Depuis du texte",
    icon: TypeIcon,
    ready: true,
  },
  {
    id: "files-to-pdf",
    label: "Convertir en PDF",
    desc: "Word, Excel, PPT",
    icon: FileInput,
    ready: true,
  },
];

const ANNOT_TOOLS: Tool[] = [
  {
    id: "watermark",
    label: "Filigrane",
    desc: "Toutes les pages",
    icon: Droplet,
    ready: true,
  },
  {
    id: "add-text",
    label: "Ajouter du texte",
    desc: "Texte libre",
    icon: PenLine,
    ready: true,
  },
  {
    id: "add-image",
    label: "Ajouter une image",
    desc: "Insérer une image",
    icon: ImageIcon,
    ready: true,
  },
  {
    id: "signature",
    label: "Signer",
    desc: "Votre signature",
    icon: FileSignature,
    ready: true,
  },
  {
    id: "fill-form",
    label: "Remplir un formulaire",
    desc: "Champs et cases",
    icon: ClipboardList,
    ready: true,
  },
];

/* Extraire & fichier — fusion de deux anciennes sections proches. */
const EXTRACT_TOOLS: Tool[] = [
  {
    id: "pdf-to-images",
    label: "PDF → Images",
    desc: "Chaque page",
    icon: ImagesIcon,
    ready: true,
  },
  {
    id: "extract-text",
    label: "Extraire le texte",
    desc: "Sauver en .txt",
    icon: FileType2,
    ready: true,
  },
  {
    id: "search",
    label: "Rechercher",
    desc: "Trouver un mot",
    icon: Search,
    ready: true,
  },
  { id: "duplicate", label: "Dupliquer", desc: "Copie rapide", icon: CopyIcon, ready: true },
  { id: "info", label: "Informations", desc: "Pages et taille", icon: Info, ready: true },
];

/* ---------- Page ---------- */

function PdfToolsPage() {
  const [tool, setTool] = useState<ToolId | null>(null);

  return (
    <AppShell>
      <QuickRow tools={QUICK_TOOLS} onOpen={setTool} />

      <ToolSection title="Modifier un PDF" tools={EDIT_TOOLS} onOpen={setTool} />
      <ToolSection title="Créer et convertir" tools={CREATE_TOOLS} onOpen={setTool} />
      <ToolSection title="Annoter et signer" tools={ANNOT_TOOLS} onOpen={setTool} />
      <ToolSection title="Extraire et fichier" tools={EXTRACT_TOOLS} onOpen={setTool} />

      <BottomSheetDefaultsProvider fullScreen>
        <ToolSheet tool={tool} onClose={() => setTool(null)} />
      </BottomSheetDefaultsProvider>
    </AppShell>
  );
}

/** Raccourcis : 4 tuiles compactes en une seule rangée, toujours visibles
 *  au premier écran. */
function QuickRow({ tools, onOpen }: { tools: Tool[]; onOpen: (id: ToolId) => void }) {
  return (
    <div className="mt-2 grid grid-cols-4 gap-2">
      {tools.map((t) => (
        <button
          key={`quick-${t.id}`}
          type="button"
          onClick={() => onOpen(t.id)}
          aria-label={t.label}
          className="card-surface flex min-w-0 flex-col items-center gap-1.5 px-1.5 py-3 text-center transition-transform active:scale-[0.96]"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
            <t.icon className="h-5 w-5" />
          </span>
          <span className="w-full break-words text-[11px] font-medium leading-tight text-foreground">
            {t.label}
          </span>
        </button>
      ))}
    </div>
  );
}

function ToolSection({
  title,
  tools,
  onOpen,
}: {
  title: string;
  tools: Tool[];
  onOpen: (id: ToolId) => void;
}) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
        {title}
      </h2>
      <ToolGrid tools={tools} onOpen={onOpen} />
    </section>
  );
}

/** Cartes horizontales compactes : icône à gauche, titre + description à
 *  droite. Deux colonnes en mobile, trois dès 480px. */
function ToolGrid({ tools, onOpen }: { tools: Tool[]; onOpen: (id: ToolId) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-3">
      {tools.map((t) => (
        <button
          key={t.id}
          type="button"
          onClick={() => onOpen(t.id)}
          className="card-surface group flex min-w-0 items-center gap-2.5 p-2.5 text-left transition-transform active:scale-[0.97]"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
            <t.icon className="h-[18px] w-[18px]" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium leading-[1.2] text-foreground">
              {t.label}
            </span>
            <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">
              {t.desc}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

/* ---------- Sheet router ---------- */

function ToolSheet({ tool, onClose }: { tool: ToolId | null; onClose: () => void }) {
  if (!tool) return null;
  switch (tool) {
    case "images-to-pdf":
      return <ImagesToPdfSheet onClose={onClose} />;
    case "scan":
      return <ScanSheet onClose={onClose} />;
    case "text-to-pdf":
      return <TextToPdfSheet onClose={onClose} />;
    case "files-to-pdf":
      return <FilesToPdfSheet onClose={onClose} />;
    case "merge":
      return <MergeSheet onClose={onClose} />;
    case "split":
      return <SinglePdfSheet mode="split" onClose={onClose} />;
    case "extract":
      return <SinglePdfSheet mode="extract" onClose={onClose} />;
    case "delete-pages":
      return <SinglePdfSheet mode="delete-pages" onClose={onClose} />;
    case "reorder":
      return <SinglePdfSheet mode="reorder" onClose={onClose} />;
    case "rotate":
      return <SinglePdfSheet mode="rotate" onClose={onClose} />;
    case "compress":
      return <SinglePdfSheet mode="compress" onClose={onClose} />;
    case "watermark":
      return <WatermarkSheet onClose={onClose} />;
    case "add-text":
      return <AddTextSheet onClose={onClose} />;
    case "add-image":
      return <AddImageSheet mode="image" onClose={onClose} />;
    case "signature":
      return <AddImageSheet mode="signature" onClose={onClose} />;
    case "fill-form":
      return <FillFormSheet onClose={onClose} />;
    case "pdf-to-images":
      return <PdfToImagesSheet onClose={onClose} />;
    case "extract-text":
      return <ExtractTextSheet onClose={onClose} />;
    case "search":
      return <SearchSheet onClose={onClose} />;
    case "duplicate":
      return <SinglePdfSheet mode="duplicate" onClose={onClose} />;
    case "info":
      return <SinglePdfSheet mode="info" onClose={onClose} />;
    default:
      return null;
  }
}

/* ---------- Progress hook ---------- */

function useJob() {
  const [progress, setProgress] = useState<OpProgressEvent | null>(null);
  const [running, setRunning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const start = () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setRunning(true);
    setProgress({
      completed: 0,
      total: 0,
      bytes: 0,
      totalBytes: 0,
      currentName: "Préparation…",
      elapsedMs: 0,
    });
    return ctrl;
  };

  const update = (p: {
    completed: number;
    total: number;
    currentName?: string;
    elapsedMs: number;
    etaMs?: number;
  }) => {
    setProgress({
      completed: p.completed,
      total: p.total,
      bytes: 0,
      totalBytes: 0,
      currentName: p.currentName ?? "…",
      elapsedMs: p.elapsedMs,
      etaMs: p.etaMs,
    });
  };

  const stop = () => {
    setRunning(false);
    setProgress(null);
    abortRef.current = null;
  };

  const cancel = () => abortRef.current?.abort();

  return { progress, running, start, update, stop, cancel };
}

/** Vrai si un fichier existe déjà à ce chemin (pour prévenir un écrasement). */
async function fileExists(path: string): Promise<boolean> {
  const p = nativePlugin();
  if (!p) return false;
  try {
    await p.stat({ path });
    return true;
  } catch {
    return false;
  }
}

/* ---------- Images → PDF ---------- */

function ImagesToPdfSheet({ onClose }: { onClose: () => void }) {
  const [images, setImages] = useState<{ id: string; src: ImageSource; url: string }[]>([]);
  const [pageSize, setPageSize] = useState<PageSize>("A4");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [compression, setCompression] = useState<CompressionLevel>("medium");
  const [name, setName] = useState("document.pdf");
  const [destination, setDestination] = useState<{ rootId: string; segments: string[] } | null>(
    null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [gfPickerOpen, setGfPickerOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [createdPath, setCreatedPath] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const job = useJob();
  const confirm = useConfirm();

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const added: typeof images = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("image/")) continue;
      added.push({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        src: { kind: "file", file: f, name: f.name },
        url: URL.createObjectURL(f),
      });
    }
    setImages((prev) => [...prev, ...added]);
  };

  useEffect(() => {
    return () => {
      images.forEach((i) => URL.revokeObjectURL(i.url));
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = (idx: number, delta: number) => {
    setImages((prev) => {
      const next = [...prev];
      const j = idx + delta;
      if (j < 0 || j >= next.length) return prev;
      const [it] = next.splice(idx, 1);
      next.splice(j, 0, it);
      return next;
    });
  };
  const remove = (idx: number) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  };

  const generate = async (savePath?: string) => {
    const ctrl = job.start();
    try {
      const tmpDest =
        savePath ??
        (destination
          ? `${toAbsolutePath({ rootId: destination.rootId as never, segments: destination.segments })}/${name || "document.pdf"}`
          : resolveTempPath(name || "document.pdf"));
      const res = await imagesToPdf(
        images.map((i) => i.src),
        tmpDest,
        { pageSize, orientation, compression },
        {
          signal: ctrl.signal,
          onProgress: (p) => job.update(p),
        },
      );
      recordPdfOp({
        kind: "images-to-pdf",
        summary: `${images.length} image(s) → PDF`,
        sources: images.map((i) => i.src.name),
        outputs: [res.path],
      });
      toast.success("PDF créé", {
        description: `${res.pageCount} page${res.pageCount > 1 ? "s" : ""}, ${formatSize(res.size)}.`,
      });
      return res.path;
    } catch (e) {
      if ((e as Error).name === "AbortError") toast.info("Opération annulée.");
      else toast.error(errorMessage(e, "Impossible de terminer l'opération"));
      return null;
    } finally {
      job.stop();
    }
  };

  const preview = async () => {
    if (images.length === 0) return;
    const tmpPath = resolveTempPath(`preview-${Date.now()}.pdf`);
    const path = await generate(tmpPath);
    if (!path) return;
    try {
      const url = await readPdfBlobUrl(path);
      setPreviewUrl(url);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <BottomSheet
        open={!pickerOpen && !gfPickerOpen && !job.running && !createdPath}
        onClose={onClose}
        title="Créer un PDF depuis des images"
        footer={
          <>
            <PrimaryButton variant="ghost" onClick={onClose}>
              Fermer
            </PrimaryButton>
            <PrimaryButton variant="ghost" onClick={preview} disabled={images.length === 0}>
              Aperçu
            </PrimaryButton>
            <PrimaryButton
              onClick={() => setPickerOpen(true)}
              disabled={images.length === 0 || !name.trim()}
            >
              Enregistrer…
            </PrimaryButton>
          </>
        }
      >
        <div className="space-y-3">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="rounded-xl border border-dashed border-border p-4 text-center text-[12px] text-muted-foreground hover:text-foreground"
            >
              <ImagesIcon className="mx-auto mb-1 h-5 w-5" />
              Depuis la galerie
            </button>
            <button
              type="button"
              onClick={() => setGfPickerOpen(true)}
              className="rounded-xl border border-dashed border-border p-4 text-center text-[12px] text-muted-foreground hover:text-foreground"
            >
              <FilePlus2 className="mx-auto mb-1 h-5 w-5" />
              Depuis GeniusFiles
            </button>
          </div>

          {images.length > 0 ? (
            <div className="space-y-1.5">
              {images.map((img, i) => (
                <div
                  key={img.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2"
                >
                  <span className="w-5 text-center text-[11px] text-muted-foreground">{i + 1}</span>
                  <img src={img.url} alt="" className="h-10 w-10 rounded object-cover" />
                  <span className="flex-1 truncate text-[12px]">{img.src.name}</span>
                  <button
                    type="button"
                    onClick={() => move(i, -1)}
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label="Monter"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(i, +1)}
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label="Descendre"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => remove(i)}
                    className="rounded p-1 text-muted-foreground hover:text-red-500"
                    aria-label="Retirer"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          <div className="grid grid-cols-3 gap-2">
            <Select
              label="Format"
              value={pageSize}
              onChange={(v) => setPageSize(v as PageSize)}
              options={[
                ["A4", "A4"],
                ["Letter", "Letter"],
                ["Legal", "Legal"],
                ["A3", "A3"],
                ["A5", "A5"],
              ]}
            />
            <Select
              label="Orientation"
              value={orientation}
              onChange={(v) => setOrientation(v as Orientation)}
              options={[
                ["portrait", "Portrait"],
                ["landscape", "Paysage"],
              ]}
            />
            <Select
              label="Compression"
              value={compression}
              onChange={(v) => setCompression(v as CompressionLevel)}
              options={[
                ["low", "Faible"],
                ["medium", "Moyenne"],
                ["high", "Forte"],
              ]}
            />
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Nom du fichier
            </label>
            <TextField value={name} onChange={setName} placeholder="document.pdf" />
          </div>
        </div>
      </BottomSheet>

      <FileSourcePicker
        open={gfPickerOpen}
        title="Choisir des images"
        extensions={["jpg", "jpeg", "png", "webp", "bmp", "gif", "heic"]}
        multi
        onCancel={() => setGfPickerOpen(false)}
        onConfirm={async (paths) => {
          setGfPickerOpen(false);
          const { readBytes } = await import("@/lib/pdf/native-io");
          const added: typeof images = [];
          for (const p of paths) {
            try {
              const bytes = await readBytes(p);
              const name = p.split("/").pop() ?? "image";
              const ext = name.split(".").pop()?.toLowerCase() ?? "jpg";
              const mime =
                ext === "png"
                  ? "image/png"
                  : ext === "webp"
                    ? "image/webp"
                    : ext === "bmp"
                      ? "image/bmp"
                      : ext === "gif"
                        ? "image/gif"
                        : "image/jpeg";
              const blob = new Blob([bytes as BlobPart], { type: mime });
              added.push({
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                src: { kind: "blob", blob, name },
                url: URL.createObjectURL(blob),
              });
            } catch {
              toast.error(`Impossible d'ouvrir « ${p.split("/").pop()} »`, {
                description:
                  "Le fichier est peut-être corrompu ou dans un format non pris en charge.",
              });
            }
          }
          if (added.length) setImages((prev) => [...prev, ...added]);
        }}
      />

      <DestinationPicker
        open={pickerOpen}
        title="Enregistrer le PDF dans…"
        initial={null}
        onCancel={() => setPickerOpen(false)}
        onConfirm={async (dest) => {
          setPickerOpen(false);
          setDestination(dest);
          const finalName = name.endsWith(".pdf") ? name : `${name}.pdf`;
          const abs = `${toAbsolutePath(dest)}/${finalName}`;
          const proceed = async () => {
            const path = await generate(abs);
            if (path) setCreatedPath(path);
          };
          if (await fileExists(abs)) confirm.ask(confirmCopy.overwriteFile(finalName), proceed);
          else await proceed();
        }}
      />
      {confirm.dialog}

      <ProgressDialog
        open={job.running}
        title="Création du PDF"
        progress={job.progress}
        onCancel={job.cancel}
      />

      {previewUrl ? (
        <BottomSheet
          open
          onClose={() => {
            URL.revokeObjectURL(previewUrl);
            setPreviewUrl(null);
          }}
          title="Aperçu"
          footer={
            <PrimaryButton
              variant="ghost"
              onClick={() => {
                URL.revokeObjectURL(previewUrl);
                setPreviewUrl(null);
              }}
            >
              Fermer
            </PrimaryButton>
          }
        >
          <iframe
            src={previewUrl}
            title="Aperçu PDF"
            className="h-[60vh] w-full rounded-lg border border-border bg-black"
          />
        </BottomSheet>
      ) : null}

      {createdPath ? (
        <PostCreateActions
          path={createdPath}
          onClose={() => {
            setCreatedPath(null);
            onClose();
          }}
          onPathChanged={setCreatedPath}
        />
      ) : null}
    </>
  );
}

/* ---------- Scanner ---------- */

function ScanSheet({ onClose }: { onClose: () => void }) {
  const [pages, setPages] = useState<{ id: string; blob: Blob; url: string; name: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("scan.pdf");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [createdPath, setCreatedPath] = useState<string | null>(null);
  const [pageSize, setPageSize] = useState<PageSize>("A4");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const job = useJob();
  const confirm = useConfirm();

  useEffect(
    () => () => {
      pages.forEach((p) => URL.revokeObjectURL(p.url));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleCapture = async (file: File | null) => {
    if (!file) return;
    try {
      const { blob } = await scanFromCapture(file);
      const url = URL.createObjectURL(blob);
      setPages((prev) => [
        ...prev,
        { id: `${Date.now()}`, blob, url, name: file.name || `page-${prev.length + 1}.jpg` },
      ]);
    } catch (e) {
      toast.error(errorMessage(e, "Impossible d'utiliser la capture"));
    }
  };

  const movePage = (idx: number, delta: number) => {
    setPages((prev) => {
      const next = [...prev];
      const j = idx + delta;
      if (j < 0 || j >= next.length) return prev;
      const [it] = next.splice(idx, 1);
      next.splice(j, 0, it);
      return next;
    });
  };

  const finish = async (dest: { rootId: string; segments: string[] }) => {
    if (pages.length === 0) return;
    const ctrl = job.start();
    const abs = `${toAbsolutePath({ rootId: dest.rootId as never, segments: dest.segments })}/${
      name.endsWith(".pdf") ? name : `${name}.pdf`
    }`;
    try {
      const res = await imagesToPdf(
        pages.map((p) => ({ kind: "blob" as const, blob: p.blob, name: p.name })),
        abs,
        { pageSize, orientation, compression: "medium" },
        { signal: ctrl.signal, onProgress: (p) => job.update(p) },
      );
      recordPdfOp({
        kind: "scan",
        summary: `Scan (${pages.length} page[s])`,
        sources: pages.map((p) => p.name),
        outputs: [res.path],
      });
      toast.success("Scan enregistré", {
        description: `${res.pageCount} page${res.pageCount > 1 ? "s" : ""} numérisée${res.pageCount > 1 ? "s" : ""}.`,
      });
      setCreatedPath(res.path);
    } catch (e) {
      if ((e as Error).name === "AbortError") toast.info("Opération annulée.");
      else toast.error(errorMessage(e, "Impossible de terminer l'opération"));
    } finally {
      job.stop();
    }
  };

  return (
    <>
      <BottomSheet
        open={!pickerOpen && !job.running && !createdPath}
        onClose={onClose}
        title="Scanner un document"
        footer={
          <>
            <PrimaryButton variant="ghost" onClick={onClose}>
              Fermer
            </PrimaryButton>
            <PrimaryButton
              onClick={() => setPickerOpen(true)}
              disabled={pages.length === 0 || !name.trim()}
            >
              Enregistrer…
            </PrimaryButton>
          </>
        }
      >
        <div className="space-y-3">
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => handleCapture(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="w-full rounded-xl border border-dashed border-border p-4 text-center text-[13px] hover:text-foreground"
          >
            <ScanLine className="mx-auto mb-1 h-5 w-5 text-primary" />
            {pages.length === 0 ? "Capturer une page" : "Ajouter une page"}
          </button>
          <p className="text-[11px] text-muted-foreground">
            Détection auto des bords, correction de perspective et amélioration de la lisibilité —
            fondations offline; algorithmes IA branchés automatiquement dès disponibilité.
          </p>
          {pages.length > 0 ? (
            <div className="space-y-1.5">
              {pages.map((p, i) => (
                <div
                  key={p.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2"
                >
                  <span className="w-5 text-center text-[11px] text-muted-foreground">{i + 1}</span>
                  <img src={p.url} alt="" className="h-12 w-12 rounded object-cover" />
                  <span className="flex-1 truncate text-[12px]">{p.name}</span>
                  <button
                    type="button"
                    onClick={() => movePage(i, -1)}
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label="Monter"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => movePage(i, +1)}
                    className="rounded p-1 text-muted-foreground hover:text-foreground"
                    aria-label="Descendre"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      URL.revokeObjectURL(p.url);
                      setPages((prev) => prev.filter((x) => x.id !== p.id));
                    }}
                    className="rounded p-1 text-muted-foreground hover:text-red-500"
                    aria-label="Retirer"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <Select
              label="Format"
              value={pageSize}
              onChange={(v) => setPageSize(v as PageSize)}
              options={[
                ["A4", "A4"],
                ["Letter", "Letter"],
                ["Legal", "Legal"],
                ["A3", "A3"],
                ["A5", "A5"],
              ]}
            />
            <Select
              label="Orientation"
              value={orientation}
              onChange={(v) => setOrientation(v as Orientation)}
              options={[
                ["portrait", "Portrait"],
                ["landscape", "Paysage"],
              ]}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Nom du PDF
            </label>
            <TextField value={name} onChange={setName} placeholder="scan.pdf" />
          </div>
        </div>
      </BottomSheet>

      <DestinationPicker
        open={pickerOpen}
        title="Enregistrer dans…"
        initial={null}
        onCancel={() => setPickerOpen(false)}
        onConfirm={async (d) => {
          setPickerOpen(false);
          const finalName = name.endsWith(".pdf") ? name : `${name}.pdf`;
          const abs = `${toAbsolutePath({ rootId: d.rootId as never, segments: d.segments })}/${finalName}`;
          if (await fileExists(abs))
            confirm.ask(confirmCopy.overwriteFile(finalName), () => finish(d));
          else finish(d);
        }}
      />
      {confirm.dialog}

      <ProgressDialog
        open={job.running}
        title="Enregistrement du scan"
        progress={job.progress}
        onCancel={job.cancel}
      />

      {createdPath ? (
        <PostCreateActions
          path={createdPath}
          onClose={() => {
            setCreatedPath(null);
            onClose();
          }}
          onPathChanged={setCreatedPath}
        />
      ) : null}
    </>
  );
}

/* ---------- Merge ---------- */

function MergeSheet({ onClose }: { onClose: () => void }) {
  const [sources, setSources] = useState<
    { path: string; pageCount: number | null; size: number | null }[]
  >([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [sourcePicker, setSourcePicker] = useState(false);
  const [destPicker, setDestPicker] = useState(false);
  const [name, setName] = useState("fusion.pdf");
  const [createdPath, setCreatedPath] = useState<string | null>(null);
  const job = useJob();

  // Fetch page counts + size for each newly added source (visual metadata).
  useEffect(() => {
    const pending = sources.filter((s) => s.pageCount == null);
    if (pending.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const s of pending) {
        try {
          const info = await pdfInfo(s.path);
          if (cancelled) return;
          setSources((prev) =>
            prev.map((x) =>
              x.path === s.path ? { ...x, pageCount: info.pageCount, size: info.size } : x,
            ),
          );
        } catch {
          if (cancelled) return;
          setSources((prev) =>
            prev.map((x) => (x.path === s.path ? { ...x, pageCount: 0, size: 0 } : x)),
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sources]);

  const totalPages = sources.reduce((n, s) => n + (s.pageCount ?? 0), 0);

  const move = (idx: number, delta: number) => {
    setSources((prev) => {
      const next = [...prev];
      const j = idx + delta;
      if (j < 0 || j >= next.length) return prev;
      const [it] = next.splice(idx, 1);
      next.splice(j, 0, it);
      return next;
    });
  };

  const finish = async (dest: { rootId: string; segments: string[] }) => {
    const ctrl = job.start();
    const abs = `${toAbsolutePath({ rootId: dest.rootId as never, segments: dest.segments })}/${
      name.endsWith(".pdf") ? name : `${name}.pdf`
    }`;
    try {
      const res = await mergePdfs(
        sources.map((s) => s.path),
        abs,
        {
          signal: ctrl.signal,
          onProgress: (p) => job.update(p),
        },
      );
      recordPdfOp({
        kind: "merge",
        summary: `${sources.length} PDF fusionnés`,
        sources: sources.map((s) => s.path),
        outputs: [res.path],
      });
      toast.success("Fusion terminée", {
        description: `${sources.length} fichier${sources.length > 1 ? "s" : ""} réunis en un PDF de ${res.pageCount} page${res.pageCount > 1 ? "s" : ""}.`,
      });
      setCreatedPath(res.path);
    } catch (e) {
      if ((e as Error).name === "AbortError") toast.info("Opération annulée.");
      else toast.error(errorMessage(e, "Impossible de terminer l'opération"));
    } finally {
      job.stop();
    }
  };

  return (
    <>
      <BottomSheet
        open={!sourcePicker && !destPicker && !job.running && !expanded && !createdPath}
        onClose={onClose}
        title="Fusionner des PDF"
        footer={
          <>
            <PrimaryButton variant="ghost" onClick={onClose}>
              Fermer
            </PrimaryButton>
            <PrimaryButton
              onClick={() => setDestPicker(true)}
              disabled={sources.length < 2 || !name.trim()}
            >
              Fusionner…
            </PrimaryButton>
          </>
        }
      >
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setSourcePicker(true)}
            className="w-full rounded-xl border border-dashed border-border p-4 text-center text-[13px] hover:text-foreground"
          >
            <FilePlus2 className="mx-auto mb-1 h-5 w-5" />
            Ajouter des PDF
          </button>
          {sources.length > 0 ? (
            <>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>
                  {sources.length} fichier(s) · {totalPages || "…"} page(s) au total
                </span>
              </div>
              <ul className="space-y-1.5">
                {sources.map((s, i) => (
                  <li
                    key={s.path + i}
                    className="rounded-lg border border-border bg-surface p-2 text-[12px]"
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-5 text-center text-muted-foreground">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate">{s.path.split("/").pop()}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {s.pageCount == null
                            ? "Analyse…"
                            : `${s.pageCount} page(s)${s.size ? ` · ${formatSize(s.size)}` : ""}`}
                        </div>
                      </div>
                      <button
                        onClick={() => setExpanded(s.path)}
                        className="rounded-md border border-border px-2 py-1 text-[10px]"
                        title="Aperçu"
                      >
                        Aperçu
                      </button>
                      <button onClick={() => move(i, -1)} className="px-1">
                        ↑
                      </button>
                      <button onClick={() => move(i, +1)} className="px-1">
                        ↓
                      </button>
                      <button
                        onClick={() => setSources((p) => p.filter((_, j) => j !== i))}
                        className="px-1 text-muted-foreground"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState
              icon={Combine}
              title="Aucun PDF sélectionné"
              description="Ajoutez au moins deux fichiers."
            />
          )}
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Nom du fichier fusionné
            </label>
            <TextField value={name} onChange={setName} placeholder="fusion.pdf" />
          </div>
        </div>
      </BottomSheet>

      {/* Per-file thumbnail preview overlay */}
      <BottomSheet
        open={!!expanded}
        onClose={() => setExpanded(null)}
        title={expanded ? (expanded.split("/").pop() ?? "Aperçu") : ""}
        footer={
          <PrimaryButton variant="ghost" onClick={() => setExpanded(null)}>
            Fermer
          </PrimaryButton>
        }
      >
        {expanded ? <ThumbPreview source={expanded} /> : null}
      </BottomSheet>

      <FileSourcePicker
        open={sourcePicker}
        title="Choisir des PDF"
        extensions={["pdf"]}
        multi
        onCancel={() => setSourcePicker(false)}
        onConfirm={(paths) => {
          setSourcePicker(false);
          setSources((prev) => [
            ...prev,
            ...paths.map((p) => ({ path: p, pageCount: null, size: null })),
          ]);
        }}
      />
      <DestinationPicker
        open={destPicker}
        title="Enregistrer dans…"
        initial={null}
        onCancel={() => setDestPicker(false)}
        onConfirm={(d) => {
          setDestPicker(false);
          finish(d);
        }}
      />
      <ProgressDialog
        open={job.running}
        title="Fusion en cours"
        progress={job.progress}
        onCancel={job.cancel}
      />
      {createdPath ? (
        <PostCreateActions
          path={createdPath}
          onClose={() => {
            setCreatedPath(null);
            onClose();
          }}
          onPathChanged={setCreatedPath}
        />
      ) : null}
    </>
  );
}

/**
 * Read-only thumbnail preview used by the merge sheet to peek at any
 * added source file without leaving the flow.
 */
function ThumbPreview({ source }: { source: string }) {
  const { thumbs, pageCount, loading } = usePdfThumbnails(source);
  return (
    <div className="space-y-2">
      <PageCountBadge loading={loading} loaded={thumbs.length} total={pageCount} />
      <div className="max-h-[60vh] overflow-y-auto">
        <PageThumbGrid thumbs={thumbs} />
      </div>
    </div>
  );
}

/* ---------- Shared single-PDF sheet ---------- */

type SingleMode =
  | "split"
  | "extract"
  | "delete-pages"
  | "reorder"
  | "rotate"
  | "compress"
  | "rename"
  | "duplicate"
  | "share"
  | "info";

function SinglePdfSheet({ mode, onClose }: { mode: SingleMode; onClose: () => void }) {
  const [source, setSource] = useState<string | null>(null);
  const [info, setInfo] = useState<PdfInfo | null>(null);
  const [sourcePicker, setSourcePicker] = useState(true);
  const [destPicker, setDestPicker] = useState(false);
  const [pending, setPending] = useState<
    ((d: { rootId: string; segments: string[] }) => void) | null
  >(null);
  const [createdPath, setCreatedPath] = useState<string | null>(null);
  const [createdPaths, setCreatedPaths] = useState<string[] | null>(null);
  const job = useJob();
  const confirm = useConfirm();

  // Per-mode state (only the relevant ones are read).
  const [order, setOrder] = useState<number[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [splitMode, setSplitMode] = useState<"single" | "ranges" | "size">("ranges");
  const [splitSize, setSplitSize] = useState("5");
  const [rangesText, setRangesText] = useState("1-3, 4-");
  const [rotations, setRotations] = useState<Record<number, Rotation>>({});
  const [compression, setCompression] = useState<CompressionLevel>("medium");
  const [newName, setNewName] = useState("");

  // Load PDF metadata whenever the source changes.
  useEffect(() => {
    if (!source) return;
    pdfInfo(source)
      .then((i) => {
        setInfo(i);
        setOrder(Array.from({ length: i.pageCount }, (_, k) => k + 1));
        setSelected(new Set());
        setRotations({});
        setNewName(source.split("/").pop() ?? "");
      })
      .catch((e) =>
        toast.error(errorMessage(e, "Impossible d'ouvrir ce PDF"), {
          description:
            "Le fichier est peut-être corrompu, protégé par un mot de passe ou dans un format non pris en charge.",
        }),
      );
  }, [source]);

  // Progressive thumbnails for the visual editors.
  const needThumbs =
    mode === "split" ||
    mode === "extract" ||
    mode === "delete-pages" ||
    mode === "reorder" ||
    mode === "rotate";
  const { thumbs, pageCount, loading: thumbLoading } = usePdfThumbnails(needThumbs ? source : null);

  const toggleSelect = (p: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });

  const setRotationForSelection = (rot: Rotation) => {
    const target = selected.size ? Array.from(selected) : order;
    setRotations((prev) => {
      const next = { ...prev };
      for (const p of target) next[p] = rot;
      return next;
    });
    toast.success(
      selected.size ? `${target.length} page(s) → ${rot}°` : `Toutes les pages → ${rot}°`,
    );
  };

  // Build split ranges from the chosen split mode.
  const computeSplitRanges = (max: number): number[][] => {
    if (splitMode === "single") {
      return Array.from({ length: max }, (_, i) => [i + 1, i + 1]);
    }
    if (splitMode === "size") {
      const size = Math.max(1, parseInt(splitSize, 10) || 1);
      const out: number[][] = [];
      for (let i = 1; i <= max; i += size) out.push([i, Math.min(max, i + size - 1)]);
      return out;
    }
    // ranges text
    return rangesText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((seg) => {
        const [a, b] = seg.split("-").map((x) => x.trim());
        const start = Math.max(1, parseInt(a || "1", 10) || 1);
        const end = b ? Math.min(max, parseInt(b, 10) || max) : max;
        return [start, Math.max(start, end)];
      })
      .filter(([a, b]) => a <= max && b >= a);
  };

  const withDest = (fn: (d: { rootId: string; segments: string[] }) => void) => {
    setPending(() => fn);
    setDestPicker(true);
  };

  const runToDest = async (
    d: { rootId: string; segments: string[] },
    suffix: string,
    executor: (destPath: string, ctrl: AbortController) => Promise<void>,
  ) => {
    if (!source || !info) return;
    const ctrl = job.start();
    const base = (source.split("/").pop() ?? "document.pdf").replace(/\.pdf$/i, "");
    const abs = `${toAbsolutePath({ rootId: d.rootId as never, segments: d.segments })}/${base}${suffix}.pdf`;
    try {
      await executor(abs, ctrl);
    } catch (e) {
      if ((e as Error).name === "AbortError") toast.info("Opération annulée.");
      else toast.error(errorMessage(e, "Impossible de terminer l'opération"));
    } finally {
      job.stop();
    }
  };

  const doAction = async (d: { rootId: string; segments: string[] }) => {
    if (!source || !info) return;
    switch (mode) {
      case "split": {
        const ranges = computeSplitRanges(info.pageCount);
        if (ranges.length === 0)
          return toast.error("Plages de pages incorrectes", {
            description: "Utilisez un format comme « 1-3, 5, 8-10 ».",
          });
        await runToDest(d, "", async (_dest, ctrl) => {
          const res = await splitPdf(
            source,
            ranges,
            toAbsolutePath({ rootId: d.rootId as never, segments: d.segments }),
            (source.split("/").pop() ?? "document").replace(/\.pdf$/i, ""),
            { signal: ctrl.signal, onProgress: (p) => job.update(p) },
          );
          recordPdfOp({
            kind: "split",
            summary: `${res.files.length} fragment(s)`,
            sources: [source],
            outputs: res.files.map((f) => f.path),
          });
          toast.success("Division terminée", {
            description: `${res.files.length} fichier${res.files.length > 1 ? "s" : ""} créé${res.files.length > 1 ? "s" : ""}.`,
          });
          const paths = res.files.map((f) => f.path);
          if (paths.length === 1) setCreatedPath(paths[0]);
          else setCreatedPaths(paths);
        });
        break;
      }
      case "extract": {
        const list = Array.from(selected).sort((a, b) => a - b);
        if (list.length === 0)
          return toast.error("Aucune page sélectionnée", {
            description: "Choisissez au moins une page à extraire.",
          });
        await runToDest(d, "_extrait", async (dest, ctrl) => {
          const res = await extractPages(source, list, dest, {
            signal: ctrl.signal,
            onProgress: (p) => job.update(p),
          });
          recordPdfOp({
            kind: "extract",
            summary: `${list.length} page(s) extraite(s)`,
            sources: [source],
            outputs: [res.path],
          });
          toast.success("Extraction terminée", {
            description: `${res.pageCount} page${res.pageCount > 1 ? "s" : ""} extraite${res.pageCount > 1 ? "s" : ""} dans un nouveau PDF.`,
          });
          setCreatedPath(res.path);
        });
        break;
      }
      case "delete-pages": {
        const list = Array.from(selected).sort((a, b) => a - b);
        if (list.length === 0)
          return toast.error("Aucune page sélectionnée", {
            description: "Choisissez au moins une page à supprimer.",
          });
        if (list.length >= info.pageCount)
          return toast.error("Impossible de tout supprimer", {
            description: "Le PDF doit conserver au moins une page.",
          });
        await new Promise<void>((resolve) =>
          confirm.ask(confirmCopy.deletePages(list.length), () => resolve()),
        );
        await runToDest(d, "_nettoye", async (dest, ctrl) => {
          const res = await deletePages(source, list, dest, {
            signal: ctrl.signal,
            onProgress: (p) => job.update(p),
          });
          recordPdfOp({
            kind: "delete-pages",
            summary: `${list.length} page(s) supprimée(s)`,
            sources: [source],
            outputs: [res.path],
          });
          toast.success("Pages supprimées", {
            description: `Le PDF contient maintenant ${res.pageCount} page${res.pageCount > 1 ? "s" : ""}.`,
          });
          setCreatedPath(res.path);
        });
        break;
      }
      case "reorder": {
        await runToDest(d, "_reorganise", async (dest, ctrl) => {
          const res = await reorderPages(source, order, dest, {
            signal: ctrl.signal,
            onProgress: (p) => job.update(p),
          });
          recordPdfOp({
            kind: "reorder",
            summary: `Pages réorganisées`,
            sources: [source],
            outputs: [res.path],
          });
          toast.success("Ordre des pages mis à jour", {
            description: "Le nouveau PDF a été enregistré.",
          });
          setCreatedPath(res.path);
        });
        break;
      }
      case "rotate": {
        if (Object.keys(rotations).length === 0)
          return toast.error("Aucune rotation choisie", {
            description: "Indiquez une rotation pour au moins une page.",
          });
        await runToDest(d, "_pivote", async (dest, ctrl) => {
          const res = await rotatePages(source, rotations, dest, {
            signal: ctrl.signal,
            onProgress: (p) => job.update(p),
          });
          recordPdfOp({
            kind: "rotate",
            summary: `Rotation de ${Object.keys(rotations).length} page(s)`,
            sources: [source],
            outputs: [res.path],
          });
          toast.success("Rotation appliquée", { description: "Le PDF pivoté a été enregistré." });
          setCreatedPath(res.path);
        });
        break;
      }
      case "compress": {
        await runToDest(d, "_compresse", async (dest, ctrl) => {
          const res = await compressPdf(source, dest, compression, {
            signal: ctrl.signal,
            onProgress: (p) => job.update(p),
          });
          const pct = Math.round(res.ratio * 100);
          recordPdfOp({
            kind: "compress",
            summary: `Compression ${compression} (${pct}%)`,
            sources: [source],
            outputs: [res.path],
          });
          toast.success("Compression terminée", {
            description: `Nouveau poids : ${formatSize(res.size)} (${Math.max(0, 100 - pct)}% d'espace gagné).`,
          });
          setCreatedPath(res.path);
        });
        break;
      }
      case "duplicate": {
        const base = (source.split("/").pop() ?? "document.pdf").replace(/\.pdf$/i, "");
        const abs = `${toAbsolutePath({ rootId: d.rootId as never, segments: d.segments })}/${base}_copie.pdf`;
        try {
          const res = await duplicatePdf(source, abs);
          recordPdfOp({
            kind: "duplicate",
            summary: "Copie",
            sources: [source],
            outputs: [res.path],
          });
          toast.success("Copie créée", { description: "Le PDF a été dupliqué avec succès." });
          setCreatedPath(res.path);
        } catch (e) {
          toast.error(errorMessage(e, "Impossible de terminer l'opération"));
        }
        break;
      }
      default:
        break;
    }
  };

  const doRename = async () => {
    if (!source || !newName.trim()) return;
    try {
      const p = nativePlugin();
      if (p) {
        const res = await p.renamePath({ path: source, newName: newName.trim() });
        recordPdfOp({
          kind: "rename",
          summary: `Renommé → ${newName.trim()}`,
          sources: [source],
          outputs: [res.path],
        });
        try {
          window.dispatchEvent(new CustomEvent("gf:storage-changed"));
        } catch {
          /* ignore */
        }
        toast.success("Renommé.");
        onClose();
      } else {
        toast.info("Renommage disponible sur appareil.");
        onClose();
      }
    } catch (e) {
      toast.error(errorMessage(e, "Impossible de terminer l'opération"));
    }
  };

  const doShare = async () => {
    if (!source) return;
    try {
      const p = nativePlugin();
      if (p) await p.shareFiles({ paths: [source] });
      else toast.info("Partage disponible sur appareil.");
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, "Impossible de terminer l'opération"));
    }
  };

  const title: Record<SingleMode, string> = {
    split: "Diviser un PDF",
    extract: "Extraire des pages",
    "delete-pages": "Supprimer des pages",
    reorder: "Réorganiser les pages",
    rotate: "Faire pivoter",
    compress: "Compresser",
    rename: "Renommer",
    duplicate: "Dupliquer",
    share: "Partager",
    info: "Informations",
  };

  const cta =
    mode === "info" ? null : mode === "rename" ? (
      <PrimaryButton onClick={doRename} disabled={!source || !info || !newName.trim()}>
        Renommer
      </PrimaryButton>
    ) : mode === "share" ? (
      <PrimaryButton onClick={doShare} disabled={!source || !info}>
        Partager
      </PrimaryButton>
    ) : (
      <PrimaryButton onClick={() => withDest(doAction)} disabled={!source || !info}>
        Enregistrer…
      </PrimaryButton>
    );

  const body = (() => {
    if (!source)
      return (
        <EmptyState
          icon={FileText}
          title="Sélectionnez un PDF"
          description="Choisissez un fichier depuis votre appareil pour continuer."
        />
      );
    if (!info)
      return <p className="py-4 text-center text-[12px] text-muted-foreground">Analyse…</p>;

    switch (mode) {
      case "split":
        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">{info.pageCount} page(s)</span>
              <PageCountBadge
                loading={thumbLoading}
                loaded={thumbs.length}
                total={pageCount || info.pageCount}
              />
            </div>
            <div className="grid grid-cols-3 gap-2 text-[11px]">
              {(
                [
                  ["single", "1 page / fichier"],
                  ["size", "Tous les N"],
                  ["ranges", "Plages"],
                ] as const
              ).map(([v, lbl]) => (
                <button
                  key={v}
                  onClick={() => setSplitMode(v)}
                  className={`rounded-lg border px-2 py-2 ${
                    splitMode === v
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-surface"
                  }`}
                >
                  {lbl}
                </button>
              ))}
            </div>
            {splitMode === "size" ? (
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  Pages par fichier
                </label>
                <TextField value={splitSize} onChange={setSplitSize} />
              </div>
            ) : null}
            {splitMode === "ranges" ? (
              <div>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  Plages (ex. 1-3, 4-6)
                </label>
                <TextField value={rangesText} onChange={setRangesText} />
              </div>
            ) : null}
            <div className="max-h-[42vh] overflow-y-auto">
              <PageThumbGrid thumbs={thumbs} />
            </div>
          </div>
        );
      case "extract":
      case "delete-pages": {
        const isExtract = mode === "extract";
        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">
                {selected.size} / {info.pageCount} sélectionnée(s)
              </span>
              <div className="flex gap-2">
                <button
                  className="text-primary underline-offset-2 hover:underline"
                  onClick={() =>
                    setSelected(new Set(Array.from({ length: info.pageCount }, (_, i) => i + 1)))
                  }
                >
                  Tout sélectionner
                </button>
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setSelected(new Set())}
                >
                  Effacer
                </button>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Touchez les pages à {isExtract ? "extraire" : "supprimer"}.
            </p>
            <div className="max-h-[52vh] overflow-y-auto">
              <PageThumbGrid thumbs={thumbs} selected={selected} onToggleSelect={toggleSelect} />
            </div>
          </div>
        );
      }
      case "reorder":
        return (
          <div className="space-y-2">
            <p className="text-[11px] text-muted-foreground">
              Glissez-déposez les pages pour les réorganiser.
            </p>
            <div className="max-h-[58vh] overflow-y-auto">
              <PageThumbGrid thumbs={thumbs} order={order} onReorder={setOrder} />
            </div>
          </div>
        );
      case "rotate":
        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-muted-foreground">
                {selected.size
                  ? `${selected.size} page(s) sélectionnée(s)`
                  : "Aucune sélection = toutes les pages"}
              </span>
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setSelected(new Set())}
              >
                Effacer
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2 text-[11px]">
              {([0, 90, 180, 270] as Rotation[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setRotationForSelection(r)}
                  className="rounded-lg border border-border bg-surface py-2 hover:text-foreground"
                >
                  {r}°
                </button>
              ))}
            </div>
            <div className="max-h-[46vh] overflow-y-auto">
              <PageThumbGrid
                thumbs={thumbs}
                rotations={rotations}
                selected={selected}
                onToggleSelect={toggleSelect}
              />
            </div>
          </div>
        );
      case "compress": {
        const est = estimateCompressedSize(info.size, compression);
        const pct = Math.round((est / Math.max(1, info.size)) * 100);
        return (
          <div className="space-y-3">
            <InfoRow label="Taille actuelle" value={formatSize(info.size)} />
            <Select
              label="Niveau"
              value={compression}
              onChange={(v) => setCompression(v as CompressionLevel)}
              options={[
                ["low", "Faible — sans perte"],
                ["medium", "Moyenne — sans perte"],
                ["high", "Forte — rastérise (JPEG 75 %)"],
                ["max", "Maximum — rastérise (JPEG 55 %)"],
              ]}
            />
            <div className="rounded-lg border border-border bg-surface p-2 text-[12px]">
              Estimation : ≈ {formatSize(est)} ({pct}% de l'original, gain ≈{" "}
              {Math.max(0, 100 - pct)}
              %).
              {(compression === "high" || compression === "max") && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  ⓘ Les niveaux Forte et Maximum rastérisent les pages : le texte devient
                  non-sélectionnable.
                </p>
              )}
            </div>
          </div>
        );
      }
      case "rename":
        return (
          <div>
            <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
              Nouveau nom
            </label>
            <TextField value={newName} onChange={setNewName} />
          </div>
        );
      case "duplicate":
        return (
          <p className="text-[12px] text-muted-foreground">
            Une copie sera créée dans le dossier de votre choix.
          </p>
        );
      case "share":
        return (
          <p className="text-[12px] text-muted-foreground">
            Le PDF sera partagé via les applications disponibles sur l'appareil.
          </p>
        );
      case "info":
        return (
          <ul className="space-y-1.5 text-[12px]">
            <InfoRow label="Nom" value={source.split("/").pop() ?? "—"} />
            <InfoRow label="Emplacement" value={source} mono />
            <InfoRow label="Taille" value={formatSize(info.size)} />
            <InfoRow label="Pages" value={String(info.pageCount)} />
            <InfoRow label="Titre" value={info.title ?? "—"} />
            <InfoRow label="Auteur" value={info.author ?? "—"} />
            <InfoRow
              label="Créé le"
              value={info.createdAt ? new Date(info.createdAt).toLocaleString() : "—"}
            />
            <InfoRow
              label="Modifié le"
              value={info.modifiedAt ? new Date(info.modifiedAt).toLocaleString() : "—"}
            />
            <InfoRow label="Producteur" value={info.producer ?? "—"} />
            <InfoRow label="Créateur" value={info.creator ?? "—"} />
            <InfoRow label="Chiffré" value={info.encrypted ? "Oui" : "Non"} />
          </ul>
        );
    }
  })();

  return (
    <>
      <BottomSheet
        open={!sourcePicker && !destPicker && !job.running && !createdPath && !createdPaths}
        onClose={onClose}
        title={title[mode]}
        footer={
          <>
            <PrimaryButton variant="ghost" onClick={onClose}>
              Fermer
            </PrimaryButton>
            <PrimaryButton variant="ghost" onClick={() => setSourcePicker(true)}>
              Changer de PDF
            </PrimaryButton>
            {cta}
          </>
        }
      >
        {body}
      </BottomSheet>

      <FileSourcePicker
        open={sourcePicker}
        title="Choisir un PDF"
        extensions={["pdf"]}
        multi={false}
        onCancel={() => {
          setSourcePicker(false);
          if (!source) onClose();
        }}
        onConfirm={(paths) => {
          setSourcePicker(false);
          if (paths[0]) setSource(paths[0]);
        }}
      />
      <DestinationPicker
        open={destPicker}
        title="Enregistrer dans…"
        initial={null}
        onCancel={() => setDestPicker(false)}
        onConfirm={(d) => {
          setDestPicker(false);
          pending?.(d);
        }}
      />
      <ProgressDialog
        open={job.running}
        title={title[mode]}
        progress={job.progress}
        onCancel={job.cancel}
      />
      {confirm.dialog}
      {createdPath ? (
        <PostCreateActions
          path={createdPath}
          onClose={() => {
            setCreatedPath(null);
            onClose();
          }}
          onPathChanged={setCreatedPath}
        />
      ) : null}
      {createdPaths ? (
        <BottomSheet
          open
          onClose={() => {
            setCreatedPaths(null);
            onClose();
          }}
          title={`${createdPaths.length} fichier(s) créé(s)`}
          footer={
            <PrimaryButton
              onClick={() => {
                setCreatedPaths(null);
                onClose();
              }}
            >
              Terminé
            </PrimaryButton>
          }
        >
          <ul className="space-y-1.5">
            {createdPaths.map((p) => (
              <li
                key={p}
                className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface p-2 text-[12px]"
              >
                <span className="min-w-0 flex-1 truncate">{p.split("/").pop()}</span>
                <button
                  className="rounded-md border border-border px-2 py-1 text-[11px]"
                  onClick={() => setCreatedPath(p)}
                >
                  Actions…
                </button>
              </li>
            ))}
          </ul>
        </BottomSheet>
      ) : null}
    </>
  );
}

/* ---------- Small helpers ---------- */

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-surface px-2 py-2 text-[12px] outline-none focus:border-primary"
      >
        {options.map(([v, lbl]) => (
          <option key={v} value={v}>
            {lbl}
          </option>
        ))}
      </select>
    </label>
  );
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <li className="flex items-start justify-between gap-3 border-b border-border/40 pb-1.5">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className={`text-right text-[12px] ${mono ? "break-all font-mono text-[11px]" : ""}`}>
        {value}
      </span>
    </li>
  );
}

function ReorderList({ order, setOrder }: { order: number[]; setOrder: (o: number[]) => void }) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    setOrder(next);
  };
  return (
    <div className="max-h-[46vh] space-y-1.5 overflow-y-auto">
      {order.map((p, i) => (
        <div
          key={`${p}-${i}`}
          draggable
          onDragStart={() => setDragIdx(i)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (dragIdx != null && dragIdx !== i) move(dragIdx, i);
            setDragIdx(null);
          }}
          className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2 text-[12px]"
        >
          <span className="w-6 text-center text-muted-foreground">☰</span>
          <span className="flex-1">Page originale n° {p}</span>
          <button onClick={() => move(i, i - 1)} className="px-1">
            ↑
          </button>
          <button onClick={() => move(i, i + 1)} className="px-1">
            ↓
          </button>
        </div>
      ))}
    </div>
  );
}

/* ==========================================================================
   NEW TOOL SHEETS — added by the PDF audit.
   Each sheet uses the shared source/dest pickers and the useJob() hook.
   ========================================================================== */

/* ---------- Single-PDF loader helper ---------- */

function useSinglePdfPicker() {
  const [source, setSource] = useState<string | null>(null);
  const [info, setInfo] = useState<PdfInfo | null>(null);
  const [picker, setPicker] = useState(true);
  useEffect(() => {
    if (!source) return;
    pdfInfo(source)
      .then(setInfo)
      .catch((e) =>
        toast.error(errorMessage(e, "Impossible d'ouvrir ce PDF"), {
          description:
            "Le fichier est peut-être corrompu, protégé par un mot de passe ou dans un format non pris en charge.",
        }),
      );
  }, [source]);
  return { source, info, picker, setPicker, setSource };
}

/* ==========================================================================
   Annoter et signer — visual WYSIWYG sheets built on <PdfAnnotator />.
   Common flow: pick PDF → render pages → add / drag / resize / rotate
   overlays → pick destination → real save → post-create actions.
   ========================================================================== */

/* ---------- Shared bits ---------- */

function useUndoState<T>(initial: T) {
  const [state, setState] = useState<T>(initial);
  const past = useRef<T[]>([]);
  const future = useRef<T[]>([]);
  const set = useCallback((next: T | ((prev: T) => T)) => {
    setState((prev) => {
      const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      past.current.push(prev);
      if (past.current.length > 80) past.current.shift();
      future.current = [];
      return v;
    });
  }, []);
  const undo = useCallback(() => {
    setState((prev) => {
      const p = past.current.pop();
      if (p === undefined) return prev;
      future.current.push(prev);
      return p;
    });
  }, []);
  const redo = useCallback(() => {
    setState((prev) => {
      const n = future.current.pop();
      if (n === undefined) return prev;
      past.current.push(prev);
      return n;
    });
  }, []);
  const reset = useCallback((v: T) => {
    past.current = [];
    future.current = [];
    setState(v);
  }, []);
  return {
    value: state,
    set,
    undo,
    redo,
    reset,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}

/* ---------- Watermark ---------- */

type WmScope = "all" | "odd" | "even" | "range";

function WatermarkSheet({ onClose }: { onClose: () => void }) {
  const { source, info, picker, setPicker, setSource } = useSinglePdfPicker();
  const [mode, setMode] = useState<"text" | "image">("text");
  const [text, setText] = useState("CONFIDENTIEL");
  const [family, setFamily] = useState<"helvetica" | "times" | "courier">("helvetica");
  const [bold, setBold] = useState(true);
  const [color, setColor] = useState("#111111");
  const [opacity, setOpacity] = useState(18);
  const [fontSize, setFontSize] = useState(60);
  const [angle, setAngle] = useState(-30);
  const [tile, setTile] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageWidth, setImageWidth] = useState(50); // percent
  const [scope, setScope] = useState<WmScope>("all");
  const [rangeStr, setRangeStr] = useState("");
  const [destPicker, setDestPicker] = useState(false);
  const [createdPath, setCreatedPath] = useState<string | null>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const job = useJob();

  useEffect(
    () => () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    },
    [imageUrl],
  );

  const resolvedPages = useMemo<number[] | undefined>(() => {
    if (!info) return undefined;
    if (scope === "all") return undefined;
    if (scope === "odd")
      return Array.from({ length: info.pageCount }, (_, i) => i + 1).filter((n) => n % 2 === 1);
    if (scope === "even")
      return Array.from({ length: info.pageCount }, (_, i) => i + 1).filter((n) => n % 2 === 0);
    // range: "1-3,5,8-10"
    const out = new Set<number>();
    for (const part of rangeStr.split(",")) {
      const seg = part.trim();
      if (!seg) continue;
      const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(seg);
      if (!m) continue;
      const a = Math.max(1, Math.min(info.pageCount, Number(m[1])));
      const b = m[2] ? Math.max(1, Math.min(info.pageCount, Number(m[2]))) : a;
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
    }
    return Array.from(out).sort((x, y) => x - y);
  }, [scope, rangeStr, info]);

  const canSave = !!source && (mode === "text" ? text.trim().length > 0 : !!imageFile);

  const run = async (d: { rootId: string; segments: string[] }) => {
    if (!source) return;
    const ctrl = job.start();
    const base = (source.split("/").pop() ?? "document.pdf").replace(/\.pdf$/i, "");
    const abs = `${toAbsolutePath({ rootId: d.rootId as never, segments: d.segments })}/${base}_filigrane.pdf`;
    try {
      const rgbHex = hexToRgb01(color);
      let imagePayload: { bytes: Uint8Array; mime: string } | undefined;
      if (mode === "image" && imageFile) {
        const buf = new Uint8Array(await imageFile.arrayBuffer());
        imagePayload = {
          bytes: buf,
          mime: imageFile.type === "image/png" ? "image/png" : "image/jpeg",
        };
      }
      const res = await watermarkPdf(
        source,
        abs,
        {
          text: mode === "text" ? text : undefined,
          image: imagePayload,
          opacity: Math.max(0.02, Math.min(1, opacity / 100)),
          fontSize: Math.max(10, fontSize),
          angle,
          color: rgbHex,
          family,
          bold,
          tile,
          pages: resolvedPages,
          imageWidth: imageWidth / 100,
        },
        { signal: ctrl.signal, onProgress: (p) => job.update(p) },
      );
      recordPdfOp({
        kind: "watermark" as never,
        summary: `Filigrane sur ${res.pageCount} page(s)`,
        sources: [source],
        outputs: [res.path],
      });
      toast.success("Filigrane appliqué", {
        description: `Nouveau fichier de ${formatSize(res.size)}.`,
      });
      setCreatedPath(res.path);
    } catch (e) {
      if ((e as Error).name === "AbortError") toast.info("Opération annulée.");
      else toast.error(errorMessage(e, "Impossible de terminer l'opération"));
    } finally {
      job.stop();
    }
  };

  return (
    <>
      <BottomSheet
        open={!picker && !destPicker && !job.running && !createdPath}
        onClose={onClose}
        title="Ajouter un filigrane"
        footer={
          <>
            <PrimaryButton variant="ghost" onClick={onClose}>
              Fermer
            </PrimaryButton>
            <PrimaryButton variant="ghost" onClick={() => setPicker(true)}>
              Changer
            </PrimaryButton>
            <PrimaryButton onClick={() => setDestPicker(true)} disabled={!canSave}>
              Enregistrer…
            </PrimaryButton>
          </>
        }
      >
        {!info ? (
          <p className="py-4 text-center text-[12px] text-muted-foreground">Analyse…</p>
        ) : (
          <div className="space-y-3">
            <InfoRow label="Pages" value={String(info.pageCount)} />
            <div className="flex gap-1 rounded-lg border border-border p-0.5 text-[12px]">
              <button
                type="button"
                onClick={() => setMode("text")}
                className={`flex-1 rounded-md py-1 ${mode === "text" ? "bg-primary text-primary-foreground" : ""}`}
              >
                Texte
              </button>
              <button
                type="button"
                onClick={() => setMode("image")}
                className={`flex-1 rounded-md py-1 ${mode === "image" ? "bg-primary text-primary-foreground" : ""}`}
              >
                Image
              </button>
            </div>

            {mode === "text" ? (
              <>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    Texte
                  </label>
                  <TextField value={text} onChange={setText} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="text-[11px] text-muted-foreground">
                    Police
                    <select
                      value={family}
                      onChange={(e) => setFamily(e.target.value as typeof family)}
                      className="mt-1 w-full rounded border border-border bg-background px-1 py-1 text-[12px] text-foreground"
                    >
                      <option value="helvetica">Helvetica</option>
                      <option value="times">Times</option>
                      <option value="courier">Courier</option>
                    </select>
                  </label>
                  <label className="text-[11px] text-muted-foreground">
                    Taille
                    <input
                      type="number"
                      min={10}
                      max={300}
                      value={fontSize}
                      onChange={(e) => setFontSize(Number(e.target.value) || 60)}
                      className="mt-1 w-full rounded border border-border bg-background px-1 py-1 text-[12px]"
                    />
                  </label>
                  <label className="text-[11px] text-muted-foreground">
                    Couleur
                    <input
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="mt-1 h-8 w-full rounded border border-border"
                    />
                  </label>
                </div>
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={bold}
                    onChange={(e) => setBold(e.target.checked)}
                  />
                  Gras
                </label>
              </>
            ) : (
              <div>
                <input
                  ref={imgRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setImageFile(f);
                    if (imageUrl) URL.revokeObjectURL(imageUrl);
                    setImageUrl(f ? URL.createObjectURL(f) : null);
                  }}
                />
                <button
                  type="button"
                  onClick={() => imgRef.current?.click()}
                  className="w-full rounded-xl border border-dashed border-border p-3 text-center text-[12px]"
                >
                  <ImageIcon className="mx-auto mb-1 h-5 w-5" />
                  {imageFile ? imageFile.name : "Choisir une image (PNG/JPG)"}
                </button>
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt=""
                    className="mt-2 max-h-24 rounded border border-border"
                  />
                ) : null}
                <label className="mt-2 block text-[11px] text-muted-foreground">
                  Largeur ({imageWidth}% de la page)
                  <input
                    type="range"
                    min={10}
                    max={100}
                    value={imageWidth}
                    onChange={(e) => setImageWidth(Number(e.target.value))}
                    className="mt-1 w-full"
                  />
                </label>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <label className="text-[11px] text-muted-foreground">
                Opacité ({opacity}%)
                <input
                  type="range"
                  min={5}
                  max={100}
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                  className="mt-1 w-full"
                />
              </label>
              <label className="text-[11px] text-muted-foreground">
                Rotation ({angle}°)
                <input
                  type="range"
                  min={-90}
                  max={90}
                  value={angle}
                  onChange={(e) => setAngle(Number(e.target.value))}
                  className="mt-1 w-full"
                />
              </label>
            </div>

            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <input type="checkbox" checked={tile} onChange={(e) => setTile(e.target.checked)} />
              Répéter sur toute la page (mosaïque)
            </label>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                Pages concernées
              </label>
              <div className="flex gap-1 text-[11px]">
                {(["all", "odd", "even", "range"] as WmScope[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScope(s)}
                    className={`flex-1 rounded border px-2 py-1 ${scope === s ? "border-primary bg-primary/10 text-primary" : "border-border"}`}
                  >
                    {s === "all"
                      ? "Toutes"
                      : s === "odd"
                        ? "Impaires"
                        : s === "even"
                          ? "Paires"
                          : "Plage"}
                  </button>
                ))}
              </div>
              {scope === "range" ? (
                <div className="mt-2">
                  <TextField
                    value={rangeStr}
                    onChange={setRangeStr}
                    placeholder="ex : 1-3, 5, 8-10"
                  />
                </div>
              ) : null}
            </div>
          </div>
        )}
      </BottomSheet>

      <FileSourcePicker
        open={picker}
        title="Choisir un PDF"
        extensions={["pdf"]}
        multi={false}
        onCancel={() => {
          setPicker(false);
          if (!source) onClose();
        }}
        onConfirm={(paths) => {
          setPicker(false);
          if (paths[0]) setSource(paths[0]);
        }}
      />
      <DestinationPicker
        open={destPicker}
        title="Enregistrer dans…"
        initial={null}
        onCancel={() => setDestPicker(false)}
        onConfirm={(d) => {
          setDestPicker(false);
          run(d);
        }}
      />
      <ProgressDialog
        open={job.running}
        title="Filigrane"
        progress={job.progress}
        onCancel={job.cancel}
      />
      {createdPath ? (
        <PostCreateActions
          path={createdPath}
          onClose={() => {
            setCreatedPath(null);
            onClose();
          }}
          onPathChanged={setCreatedPath}
        />
      ) : null}
    </>
  );
}

/* ---------- Visual editor shell (Add Text / Image / Signature) ---------- */

function VisualEditorSheet({
  title,
  suffix,
  source,
  info,
  onChangePdf,
  onClose,
  toolbarExtras,
  elements,
  setElements,
  undo,
  redo,
  canUndo,
  canRedo,
  onCurrentPageChange,
  bodyExtra,
  suspended,
  runOp,
}: {
  title: string;
  suffix: string;
  source: string;
  info: PdfInfo;
  onChangePdf: () => void;
  onClose: () => void;
  toolbarExtras: AnnotToolbarItem[];
  elements: AnnotElement[];
  setElements: (next: AnnotElement[] | ((prev: AnnotElement[]) => AnnotElement[])) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onCurrentPageChange?: (page: number) => void;
  bodyExtra?: React.ReactNode;
  suspended?: boolean;
  runOp: (
    destAbs: string,
    ctrl: AbortController,
  ) => Promise<{ path: string; size: number; pageCount: number }>;
}) {
  const [destPicker, setDestPicker] = useState(false);
  const [createdPath, setCreatedPath] = useState<string | null>(null);
  const job = useJob();
  void info;

  const run = async (d: { rootId: string; segments: string[] }) => {
    const ctrl = job.start();
    const base = (source.split("/").pop() ?? "document.pdf").replace(/\.pdf$/i, "");
    const abs = `${toAbsolutePath({ rootId: d.rootId as never, segments: d.segments })}/${base}_${suffix}.pdf`;
    try {
      const res = await runOp(abs, ctrl);
      recordPdfOp({
        kind: "rename" as never,
        summary: title,
        sources: [source],
        outputs: [res.path],
      });
      toast.success("Modifications enregistrées", {
        description: `Fichier de ${formatSize(res.size)}.`,
      });
      setCreatedPath(res.path);
    } catch (e) {
      if ((e as Error).name === "AbortError") toast.info("Opération annulée.");
      else toast.error(errorMessage(e, "Impossible de terminer l'opération"));
    } finally {
      job.stop();
    }
  };

  return (
    <>
      <BottomSheet
        open={!suspended && !destPicker && !job.running && !createdPath}
        onClose={onClose}
        title={title}
        footer={
          <>
            <PrimaryButton variant="ghost" onClick={onClose}>
              Fermer
            </PrimaryButton>
            <PrimaryButton variant="ghost" onClick={onChangePdf}>
              Changer
            </PrimaryButton>
            <PrimaryButton onClick={() => setDestPicker(true)} disabled={elements.length === 0}>
              Enregistrer…
            </PrimaryButton>
          </>
        }
      >
        <div className="space-y-3">
          <PdfAnnotator
            source={source}
            elements={elements}
            onChange={setElements}
            onUndo={undo}
            onRedo={redo}
            canUndo={canUndo}
            canRedo={canRedo}
            toolbar={toolbarExtras}
            onCurrentPageChange={onCurrentPageChange}
          />
          {bodyExtra}
        </div>
      </BottomSheet>
      <DestinationPicker
        open={destPicker}
        title="Enregistrer dans…"
        initial={null}
        onCancel={() => setDestPicker(false)}
        onConfirm={(d) => {
          setDestPicker(false);
          run(d);
        }}
      />
      <ProgressDialog
        open={job.running}
        title={title}
        progress={job.progress}
        onCancel={job.cancel}
      />
      {createdPath ? (
        <PostCreateActions
          path={createdPath}
          onClose={() => {
            setCreatedPath(null);
            onClose();
          }}
          onPathChanged={setCreatedPath}
        />
      ) : null}
    </>
  );
}

/* ---------- Add text (visual) ---------- */

function AddTextSheet({ onClose }: { onClose: () => void }) {
  const { source, info, picker, setPicker, setSource } = useSinglePdfPicker();
  const undoable = useUndoState<AnnotElement[]>([]);
  const [currentPage, setCurrentPage] = useState(1);

  const addText = () => {
    const el: TextElement = {
      id: newId("text"),
      kind: "text",
      page: currentPage,
      x: 0.15,
      y: 0.15,
      wFrac: 0.5,
      text: "Nouveau texte",
      fontSize: 18,
      color: "#111111",
      family: "helvetica",
      bold: false,
      italic: false,
      underline: false,
      align: "left",
      rotate: 0,
      opacity: 1,
    };
    undoable.set((prev) => [...prev, el]);
  };

  if (!source || !info) {
    return (
      <FileSourcePicker
        open={picker}
        title="Choisir un PDF"
        extensions={["pdf"]}
        multi={false}
        onCancel={() => {
          setPicker(false);
          onClose();
        }}
        onConfirm={(paths) => {
          setPicker(false);
          if (paths[0]) setSource(paths[0]);
        }}
      />
    );
  }

  return (
    <>
      <VisualEditorSheet
        title="Ajouter du texte"
        suffix="texte"
        source={source}
        info={info}
        onChangePdf={() => setPicker(true)}
        onClose={onClose}
        toolbarExtras={[{ id: "add", label: "+ Texte", onClick: addText }]}
        elements={undoable.value}
        setElements={undoable.set}
        undo={undoable.undo}
        redo={undoable.redo}
        canUndo={undoable.canUndo}
        canRedo={undoable.canRedo}
        onCurrentPageChange={setCurrentPage}
        suspended={picker}
        runOp={async (abs, ctrl) => {
          const overlays: TextOverlay[] = undoable.value
            .filter((e): e is TextElement => e.kind === "text")
            .map((t) => {
              const c = hexToRgb01(t.color);
              return {
                page: t.page,
                text: t.text,
                x: t.x,
                y: t.y,
                fontSize: t.fontSize,
                color: c,
                family: t.family,
                bold: t.bold,
                italic: t.italic,
                underline: t.underline,
                rotate: t.rotate,
                opacity: t.opacity,
                align: t.align,
                maxWidth: t.wFrac,
              };
            });
          return addTextToPdf(source, abs, overlays, { signal: ctrl.signal });
        }}
      />
      <FileSourcePicker
        open={picker}
        title="Choisir un PDF"
        extensions={["pdf"]}
        multi={false}
        onCancel={() => {
          setPicker(false);
        }}
        onConfirm={(paths) => {
          setPicker(false);
          if (paths[0]) {
            setSource(paths[0]);
            undoable.reset([]);
          }
        }}
      />
    </>
  );
}

/* ---------- Add image / Signer (visual) ---------- */

function AddImageSheet({ mode, onClose }: { mode: "image" | "signature"; onClose: () => void }) {
  const { source, info, picker, setPicker, setSource } = useSinglePdfPicker();
  const undoable = useUndoState<AnnotElement[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const fileInput = useRef<HTMLInputElement>(null);
  const [signatures, setSignatures] = useState<StoredSignature[]>(() => listSignatures());
  const [padOpen, setPadOpen] = useState(false);
  const [padCanvas, setPadCanvas] = useState<HTMLCanvasElement | null>(null);
  const [pickerListOpen, setPickerListOpen] = useState(false);

  const refreshSigs = () => setSignatures(listSignatures());

  const placeImagePayload = async (
    dataUrl: string,
    mime: "image/png" | "image/jpeg",
    aspect: number,
    kind: "image" | "signature",
  ) => {
    const wFrac = kind === "signature" ? 0.35 : 0.4;
    const hFrac = wFrac * (1 / aspect) * (info?.pageCount ? 1 : 1); // ratio applied when drawing
    const el: ImageElement = {
      id: newId(kind),
      kind,
      page: currentPage,
      x: 0.2,
      y: kind === "signature" ? 0.75 : 0.2,
      wFrac,
      hFrac,
      rotate: 0,
      opacity: 1,
      dataUrl,
      mime,
      aspect,
    };
    undoable.set((prev) => [...prev, el]);
  };

  const onImageFile = async (file: File | null) => {
    if (!file) return;
    const payload = await imageFileToElementPayload(file);
    await placeImagePayload(payload.dataUrl, payload.mime, payload.aspect, mode);
  };

  const savePadAsSignature = async (name: string) => {
    if (!padCanvas || isSignatureCanvasBlank(padCanvas)) {
      toast.error("Signature vide", {
        description: "Dessinez votre signature avant de l'enregistrer.",
      });
      return;
    }
    const dataUrl = await trimSignatureCanvas(padCanvas);
    const img = new Image();
    await new Promise((r) => {
      img.onload = r;
      img.src = dataUrl;
    });
    saveSignature(name || "Signature", dataUrl);
    refreshSigs();
    setPadOpen(false);
    await placeImagePayload(
      dataUrl,
      "image/png",
      img.naturalWidth / img.naturalHeight,
      "signature",
    );
  };

  const useSavedSignature = async (s: StoredSignature) => {
    const img = new Image();
    await new Promise((r) => {
      img.onload = r;
      img.src = s.dataUrl;
    });
    setPickerListOpen(false);
    await placeImagePayload(
      s.dataUrl,
      "image/png",
      img.naturalWidth / img.naturalHeight,
      "signature",
    );
  };

  const toolbar: AnnotToolbarItem[] =
    mode === "image"
      ? [{ id: "add", label: "+ Image", onClick: () => fileInput.current?.click() }]
      : [
          { id: "draw", label: "Dessiner", onClick: () => setPadOpen(true) },
          {
            id: "saved",
            label: `Enregistrées (${signatures.length})`,
            onClick: () => setPickerListOpen(true),
            disabled: signatures.length === 0,
          },
          { id: "import", label: "Importer", onClick: () => fileInput.current?.click() },
        ];

  if (!source || !info) {
    return (
      <FileSourcePicker
        open={picker}
        title="Choisir un PDF"
        extensions={["pdf"]}
        multi={false}
        onCancel={() => {
          setPicker(false);
          onClose();
        }}
        onConfirm={(paths) => {
          setPicker(false);
          if (paths[0]) setSource(paths[0]);
        }}
      />
    );
  }

  return (
    <>
      <VisualEditorSheet
        title={mode === "signature" ? "Signer le PDF" : "Ajouter une image"}
        suffix={mode === "signature" ? "signe" : "image"}
        source={source}
        info={info}
        onChangePdf={() => setPicker(true)}
        onClose={onClose}
        toolbarExtras={toolbar}
        elements={undoable.value}
        setElements={undoable.set}
        undo={undoable.undo}
        redo={undoable.redo}
        canUndo={undoable.canUndo}
        canRedo={undoable.canRedo}
        onCurrentPageChange={setCurrentPage}
        suspended={picker || padOpen || pickerListOpen}
        bodyExtra={
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              onImageFile(e.target.files?.[0] ?? null);
              e.currentTarget.value = "";
            }}
          />
        }
        runOp={async (abs, ctrl) => {
          const overlays: ImageOverlay[] = undoable.value
            .filter((e): e is ImageElement => e.kind === "image" || e.kind === "signature")
            .map((im) => ({
              page: im.page,
              bytes: dataUrlToBytes(im.dataUrl),
              mime: im.mime,
              x: im.x,
              y: im.y,
              w: im.wFrac,
              h: im.hFrac,
              opacity: im.opacity,
              rotate: im.rotate,
            }));
          return addImageToPdf(source, abs, overlays, { signal: ctrl.signal });
        }}
      />

      {padOpen ? (
        <SignatureCreateDialog
          onCancel={() => setPadOpen(false)}
          onCanvasReady={setPadCanvas}
          onSave={savePadAsSignature}
        />
      ) : null}

      {pickerListOpen ? (
        <SignatureLibraryDialog
          signatures={signatures}
          onCancel={() => setPickerListOpen(false)}
          onUse={useSavedSignature}
          onRename={(id, name) => {
            renameSignature(id, name);
            refreshSigs();
          }}
          onDelete={(id) => {
            deleteSignature(id);
            refreshSigs();
          }}
        />
      ) : null}

      <FileSourcePicker
        open={picker}
        title="Choisir un PDF"
        extensions={["pdf"]}
        multi={false}
        onCancel={() => {
          setPicker(false);
        }}
        onConfirm={(paths) => {
          setPicker(false);
          if (paths[0]) {
            setSource(paths[0]);
            undoable.reset([]);
          }
        }}
      />
    </>
  );
}

function SignatureCreateDialog({
  onCancel,
  onCanvasReady,
  onSave,
}: {
  onCancel: () => void;
  onCanvasReady: (c: HTMLCanvasElement) => void;
  onSave: (name: string) => Promise<void> | void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const clearRef = useRef<HTMLCanvasElement | null>(null);
  return (
    <BottomSheet
      open
      onClose={onCancel}
      title="Nouvelle signature"
      footer={
        <>
          <PrimaryButton variant="ghost" onClick={onCancel}>
            Annuler
          </PrimaryButton>
          <PrimaryButton
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onSave(name);
              setBusy(false);
            }}
          >
            Enregistrer et placer
          </PrimaryButton>
        </>
      }
    >
      <div className="space-y-2">
        <label className="text-[11px] text-muted-foreground">
          Nom
          <TextField value={name} onChange={setName} placeholder="ex : signature perso" />
        </label>
        <SignaturePad
          onReady={(c) => {
            clearRef.current = c;
            onCanvasReady(c);
          }}
        />
        <button
          type="button"
          onClick={() => {
            const c = clearRef.current;
            if (!c) return;
            const ctx = c.getContext("2d");
            if (!ctx) return;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, c.width, c.height);
          }}
          className="text-[11px] text-muted-foreground underline"
        >
          Effacer
        </button>
      </div>
    </BottomSheet>
  );
}

function SignatureLibraryDialog({
  signatures,
  onCancel,
  onUse,
  onRename,
  onDelete,
}: {
  signatures: StoredSignature[];
  onCancel: () => void;
  onUse: (s: StoredSignature) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <BottomSheet
      open
      onClose={onCancel}
      title="Signatures enregistrées"
      footer={
        <PrimaryButton variant="ghost" onClick={onCancel}>
          Fermer
        </PrimaryButton>
      }
    >
      <div className="space-y-2">
        {signatures.map((s) => (
          <div key={s.id} className="flex items-center gap-2 rounded-lg border border-border p-2">
            <img src={s.dataUrl} alt="" className="h-10 w-16 rounded bg-white object-contain" />
            <input
              defaultValue={s.name}
              onBlur={(e) => onRename(s.id, e.target.value)}
              className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-1 text-[12px] focus:border-border"
            />
            <button
              type="button"
              onClick={() => onUse(s)}
              className="rounded border border-primary bg-primary/10 px-2 py-1 text-[11px] text-primary"
            >
              Placer
            </button>
            <button
              type="button"
              onClick={() => onDelete(s.id)}
              className="rounded border border-destructive/40 p-1 text-destructive"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </BottomSheet>
  );
}

/* ---------- Fill form (interactive + free-text fallback) ---------- */

function FillFormSheet({ onClose }: { onClose: () => void }) {
  const { source, info, picker, setPicker, setSource } = useSinglePdfPicker();
  const [fields, setFields] = useState<FormFieldInfo[] | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [flatten, setFlatten] = useState(true);
  const [destPicker, setDestPicker] = useState(false);
  const [createdPath, setCreatedPath] = useState<string | null>(null);
  const [freeMode, setFreeMode] = useState(false);
  const undoable = useUndoState<AnnotElement[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const job = useJob();

  useEffect(() => {
    if (!source) return;
    setFields(null);
    readPdfForm(source)
      .then((f) => {
        setFields(f);
        const init: Record<string, string | boolean> = {};
        f.forEach((fd) => {
          init[fd.name] = (fd.value as string | boolean) ?? (fd.type === "checkbox" ? false : "");
        });
        setValues(init);
        setFreeMode(f.length === 0);
      })
      .catch((e) =>
        toast.error(errorMessage(e, "Impossible de lire ce formulaire"), {
          description: "Le PDF ne contient peut-être pas de champs remplissables.",
        }),
      );
  }, [source]);

  const addFreeText = () => {
    const el: TextElement = {
      id: newId("text"),
      kind: "text",
      page: currentPage,
      x: 0.15,
      y: 0.15,
      wFrac: 0.4,
      text: "Texte",
      fontSize: 14,
      color: "#000000",
      family: "helvetica",
      bold: false,
      italic: false,
      underline: false,
      align: "left",
      rotate: 0,
      opacity: 1,
    };
    undoable.set((prev) => [...prev, el]);
  };

  const runInteractive = async (d: { rootId: string; segments: string[] }) => {
    if (!source) return;
    const ctrl = job.start();
    const base = (source.split("/").pop() ?? "document.pdf").replace(/\.pdf$/i, "");
    const abs = `${toAbsolutePath({ rootId: d.rootId as never, segments: d.segments })}/${base}_rempli.pdf`;
    try {
      const res = await fillPdfForm(source, abs, values, { flatten, signal: ctrl.signal });
      recordPdfOp({
        kind: "rename" as never,
        summary: "Formulaire rempli",
        sources: [source],
        outputs: [res.path],
      });
      toast.success("Formulaire enregistré", { description: "Le PDF rempli a été sauvegardé." });
      setCreatedPath(res.path);
    } catch (e) {
      toast.error(errorMessage(e, "Impossible de terminer l'opération"));
    } finally {
      job.stop();
    }
  };

  // Free-text branch delegates to the visual editor sheet.
  if (source && info && freeMode) {
    return (
      <>
        <VisualEditorSheet
          title="Remplir un formulaire"
          suffix="rempli"
          source={source}
          info={info}
          onChangePdf={() => setPicker(true)}
          onClose={onClose}
          toolbarExtras={[
            { id: "add", label: "+ Champ texte", onClick: addFreeText },
            {
              id: "back",
              label: fields && fields.length ? "Champs interactifs" : "—",
              onClick: () => setFreeMode(false),
              disabled: !(fields && fields.length),
            },
          ]}
          elements={undoable.value}
          setElements={undoable.set}
          undo={undoable.undo}
          redo={undoable.redo}
          canUndo={undoable.canUndo}
          canRedo={undoable.canRedo}
          onCurrentPageChange={setCurrentPage}
          suspended={picker}
          runOp={async (abs, ctrl) => {
            const overlays: TextOverlay[] = undoable.value
              .filter((e): e is TextElement => e.kind === "text")
              .map((t) => {
                const c = hexToRgb01(t.color);
                return {
                  page: t.page,
                  text: t.text,
                  x: t.x,
                  y: t.y,
                  fontSize: t.fontSize,
                  color: c,
                  family: t.family,
                  bold: t.bold,
                  italic: t.italic,
                  underline: t.underline,
                  rotate: t.rotate,
                  opacity: t.opacity,
                  align: t.align,
                  maxWidth: t.wFrac,
                };
              });
            return addTextToPdf(source, abs, overlays, { signal: ctrl.signal });
          }}
        />
        <FileSourcePicker
          open={picker}
          title="Choisir un PDF"
          extensions={["pdf"]}
          multi={false}
          onCancel={() => {
            setPicker(false);
          }}
          onConfirm={(paths) => {
            setPicker(false);
            if (paths[0]) {
              setSource(paths[0]);
              undoable.reset([]);
            }
          }}
        />
      </>
    );
  }

  return (
    <>
      <BottomSheet
        open={!picker && !destPicker && !job.running && !createdPath}
        onClose={onClose}
        title="Remplir un formulaire"
        footer={
          <>
            <PrimaryButton variant="ghost" onClick={onClose}>
              Fermer
            </PrimaryButton>
            <PrimaryButton variant="ghost" onClick={() => setPicker(true)}>
              Changer
            </PrimaryButton>
            <PrimaryButton
              onClick={() => setDestPicker(true)}
              disabled={!source || !fields || fields.length === 0}
            >
              Enregistrer…
            </PrimaryButton>
          </>
        }
      >
        {!fields ? (
          <p className="py-4 text-center text-[12px] text-muted-foreground">Analyse…</p>
        ) : fields.length === 0 ? (
          <div className="space-y-3">
            <EmptyState
              icon={ClipboardList}
              title="Aucun champ interactif"
              description="Ce PDF ne contient pas de formulaire. Vous pouvez ajouter du texte librement sur les pages."
            />
            <PrimaryButton onClick={() => setFreeMode(true)}>
              Ajouter du texte librement
            </PrimaryButton>
          </div>
        ) : (
          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {fields.map((f) => (
              <div key={f.name}>
                <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                  {f.name}
                </label>
                {f.type === "checkbox" ? (
                  <label className="flex items-center gap-2 text-[12px]">
                    <input
                      type="checkbox"
                      checked={!!values[f.name]}
                      onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.checked }))}
                    />
                    {values[f.name] ? "Coché" : "Non coché"}
                  </label>
                ) : f.type === "dropdown" || f.type === "radio" ? (
                  <select
                    className="w-full rounded-lg border border-border bg-surface px-2 py-2 text-[12px]"
                    value={String(values[f.name] ?? "")}
                    onChange={(e) => setValues((v) => ({ ...v, [f.name]: e.target.value }))}
                  >
                    <option value="">—</option>
                    {(f.options ?? []).map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                ) : (
                  <TextField
                    value={String(values[f.name] ?? "")}
                    onChange={(x) => setValues((v) => ({ ...v, [f.name]: x }))}
                  />
                )}
              </div>
            ))}
            <label className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={flatten}
                onChange={(e) => setFlatten(e.target.checked)}
              />
              Verrouiller le formulaire après remplissage
            </label>
            <button
              type="button"
              onClick={() => setFreeMode(true)}
              className="mt-2 text-[11px] text-primary underline"
            >
              Ajouter aussi du texte libre…
            </button>
          </div>
        )}
      </BottomSheet>
      <FileSourcePicker
        open={picker}
        title="Choisir un PDF"
        extensions={["pdf"]}
        multi={false}
        onCancel={() => {
          setPicker(false);
          if (!source) onClose();
        }}
        onConfirm={(paths) => {
          setPicker(false);
          if (paths[0]) setSource(paths[0]);
        }}
      />
      <DestinationPicker
        open={destPicker}
        title="Enregistrer dans…"
        initial={null}
        onCancel={() => setDestPicker(false)}
        onConfirm={(d) => {
          setDestPicker(false);
          runInteractive(d);
        }}
      />
      <ProgressDialog
        open={job.running}
        title="Formulaire"
        progress={job.progress}
        onCancel={job.cancel}
      />
      {createdPath ? (
        <PostCreateActions
          path={createdPath}
          onClose={() => {
            setCreatedPath(null);
            onClose();
          }}
          onPathChanged={setCreatedPath}
        />
      ) : null}
    </>
  );
}

function PdfToImagesSheet({ onClose }: { onClose: () => void }) {
  const { source, info, picker, setPicker, setSource } = useSinglePdfPicker();
  const [format, setFormat] = useState<"png" | "jpeg">("jpeg");
  const [scale, setScale] = useState("2");
  const [pagesText, setPagesText] = useState("");
  const [destPicker, setDestPicker] = useState(false);
  const job = useJob();

  const parseList = (text: string, max: number): number[] =>
    Array.from(
      new Set(
        text
          .split(/[\s,]+/)
          .map((x) => parseInt(x, 10))
          .filter((n) => Number.isFinite(n) && n >= 1 && n <= max),
      ),
    ).sort((a, b) => a - b);

  const run = async (d: { rootId: string; segments: string[] }) => {
    if (!source || !info) return;
    const ctrl = job.start();
    const dir = toAbsolutePath({ rootId: d.rootId as never, segments: d.segments });
    try {
      const pages = pagesText.trim() ? parseList(pagesText, info.pageCount) : undefined;
      const res = await pdfToImages(
        source,
        dir,
        { format, scale: Math.max(1, Math.min(4, Number(scale) || 2)), pages },
        { signal: ctrl.signal, onProgress: (p) => job.update(p) },
      );
      recordPdfOp({
        kind: "extract" as never,
        summary: `${res.files.length} image(s) exportée(s)`,
        sources: [source],
        outputs: res.files.map((f) => f.path),
      });
      toast.success("Conversion terminée", {
        description: `${res.files.length} image${res.files.length > 1 ? "s" : ""} créée${res.files.length > 1 ? "s" : ""}.`,
      });
      onClose();
    } catch (e) {
      if ((e as Error).name === "AbortError") toast.info("Opération annulée.");
      else toast.error(errorMessage(e, "Impossible de terminer l'opération"));
    } finally {
      job.stop();
    }
  };

  return (
    <>
      <BottomSheet
        open={!picker && !destPicker && !job.running}
        onClose={onClose}
        title="PDF → Images"
        footer={
          <>
            <PrimaryButton variant="ghost" onClick={onClose}>
              Fermer
            </PrimaryButton>
            <PrimaryButton variant="ghost" onClick={() => setPicker(true)}>
              Changer de PDF
            </PrimaryButton>
            <PrimaryButton onClick={() => setDestPicker(true)} disabled={!source}>
              Enregistrer…
            </PrimaryButton>
          </>
        }
      >
        {!info ? (
          <p className="py-4 text-center text-[12px] text-muted-foreground">Analyse…</p>
        ) : (
          <div className="space-y-3">
            <InfoRow label="Pages" value={String(info.pageCount)} />
            <div className="grid grid-cols-2 gap-2">
              <Select
                label="Format"
                value={format}
                onChange={(v) => setFormat(v as "png" | "jpeg")}
                options={[
                  ["jpeg", "JPEG"],
                  ["png", "PNG"],
                ]}
              />
              <div>
                <label className="mb-1 block text-[11px] text-muted-foreground">
                  Échelle (1–4)
                </label>
                <TextField value={scale} onChange={setScale} />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">
                Pages (vide = toutes) — ex. 1,3,5-7
              </label>
              <TextField value={pagesText} onChange={setPagesText} />
            </div>
          </div>
        )}
      </BottomSheet>
      <FileSourcePicker
        open={picker}
        title="Choisir un PDF"
        extensions={["pdf"]}
        multi={false}
        onCancel={() => {
          setPicker(false);
          if (!source) onClose();
        }}
        onConfirm={(p) => {
          setPicker(false);
          if (p[0]) setSource(p[0]);
        }}
      />
      <DestinationPicker
        open={destPicker}
        title="Enregistrer dans…"
        initial={null}
        onCancel={() => setDestPicker(false)}
        onConfirm={(d) => {
          setDestPicker(false);
          run(d);
        }}
      />
      <ProgressDialog
        open={job.running}
        title="Export images"
        progress={job.progress}
        onCancel={job.cancel}
      />
    </>
  );
}

/* ---------- Extract text ---------- */

function ExtractTextSheet({ onClose }: { onClose: () => void }) {
  const { source, info, picker, setPicker, setSource } = useSinglePdfPicker();
  const [text, setText] = useState<string | null>(null);
  const [destPicker, setDestPicker] = useState(false);
  const job = useJob();

  useEffect(() => {
    if (!source) return;
    const ctrl = job.start();
    extractPdfText(source, { signal: ctrl.signal, onProgress: (p) => job.update(p) })
      .then((r) => setText(r.text))
      .catch((e) => toast.error(errorMessage(e, "Impossible d'extraire le texte")))
      .finally(() => job.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  const run = async (d: { rootId: string; segments: string[] }) => {
    if (!source || text == null) return;
    const base = (source.split("/").pop() ?? "document.pdf").replace(/\.pdf$/i, "");
    const abs = `${toAbsolutePath({ rootId: d.rootId as never, segments: d.segments })}/${base}.txt`;
    try {
      const enc = new TextEncoder();
      const bytes = enc.encode(text);
      const { nativePlugin: np } = await import("@/lib/native/geniusfiles-native");
      const p = np();
      if (p) {
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        await p.writeFileBase64({ path: abs, data: btoa(bin), overwrite: true });
      }
      window.dispatchEvent(new CustomEvent("gf:storage-changed"));
      toast.success("Texte enregistré", { description: "Le fichier texte a été créé." });
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, "Impossible de terminer l'opération"));
    }
  };

  const copy = async () => {
    if (text == null) return;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Texte copié", {
        description: "Le contenu a été copié dans le presse-papiers.",
      });
    } catch {
      toast.error("Impossible de copier le texte", {
        description: "Réessayez ou copiez-le manuellement.",
      });
    }
  };

  return (
    <>
      <BottomSheet
        open={!picker && !destPicker && !job.running}
        onClose={onClose}
        title="Extraire le texte"
        footer={
          <>
            <PrimaryButton variant="ghost" onClick={onClose}>
              Fermer
            </PrimaryButton>
            <PrimaryButton variant="ghost" onClick={() => setPicker(true)}>
              Changer de PDF
            </PrimaryButton>
            <PrimaryButton variant="ghost" onClick={copy} disabled={text == null}>
              Copier
            </PrimaryButton>
            <PrimaryButton onClick={() => setDestPicker(true)} disabled={text == null}>
              Enregistrer .txt…
            </PrimaryButton>
          </>
        }
      >
        {!info ? (
          <p className="py-4 text-center text-[12px] text-muted-foreground">Analyse…</p>
        ) : text == null ? (
          <p className="py-4 text-center text-[12px] text-muted-foreground">Extraction en cours…</p>
        ) : (
          <div className="space-y-2">
            <InfoRow label="Pages" value={String(info.pageCount)} />
            <textarea
              readOnly
              value={text}
              className="h-[45vh] w-full rounded-lg border border-border bg-surface p-2 text-[12px] font-mono"
            />
          </div>
        )}
      </BottomSheet>
      <FileSourcePicker
        open={picker}
        title="Choisir un PDF"
        extensions={["pdf"]}
        multi={false}
        onCancel={() => {
          setPicker(false);
          if (!source) onClose();
        }}
        onConfirm={(p) => {
          setPicker(false);
          if (p[0]) setSource(p[0]);
        }}
      />
      <DestinationPicker
        open={destPicker}
        title="Enregistrer dans…"
        initial={null}
        onCancel={() => setDestPicker(false)}
        onConfirm={(d) => {
          setDestPicker(false);
          run(d);
        }}
      />
      <ProgressDialog
        open={job.running}
        title="Extraction texte"
        progress={job.progress}
        onCancel={job.cancel}
      />
    </>
  );
}

/* ---------- Search ---------- */

function SearchSheet({ onClose }: { onClose: () => void }) {
  const { source, info, picker, setPicker, setSource } = useSinglePdfPicker();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const job = useJob();

  const runSearch = async () => {
    if (!source || !query.trim()) return;
    const ctrl = job.start();
    try {
      const res = await searchInPdf(source, query, {
        caseSensitive,
        signal: ctrl.signal,
        onProgress: (p) => job.update(p),
      });
      setHits(res);
    } catch (e) {
      toast.error(errorMessage(e, "Impossible de lancer la recherche"));
    } finally {
      job.stop();
    }
  };

  return (
    <>
      <BottomSheet
        open={!picker && !job.running}
        onClose={onClose}
        title="Rechercher dans le PDF"
        footer={
          <>
            <PrimaryButton variant="ghost" onClick={onClose}>
              Fermer
            </PrimaryButton>
            <PrimaryButton variant="ghost" onClick={() => setPicker(true)}>
              Changer de PDF
            </PrimaryButton>
            <PrimaryButton onClick={runSearch} disabled={!source || !query.trim()}>
              Rechercher
            </PrimaryButton>
          </>
        }
      >
        {!info ? (
          <p className="py-4 text-center text-[12px] text-muted-foreground">Analyse…</p>
        ) : (
          <div className="space-y-3">
            <InfoRow label="Pages" value={String(info.pageCount)} />
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">
                Terme à rechercher
              </label>
              <TextField value={query} onChange={setQuery} />
            </div>
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
              />
              Respecter la casse
            </label>
            {hits ? (
              hits.length === 0 ? (
                <p className="rounded-lg bg-surface p-3 text-center text-[12px] text-muted-foreground">
                  Aucun résultat.
                </p>
              ) : (
                <div className="max-h-[40vh] space-y-1.5 overflow-y-auto">
                  <p className="text-[11px] text-muted-foreground">{hits.length} résultat(s)</p>
                  {hits.map((h, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-border bg-surface p-2 text-[12px]"
                    >
                      <span className="mr-2 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                        p. {h.page}
                      </span>
                      {h.snippet}
                    </div>
                  ))}
                </div>
              )
            ) : null}
          </div>
        )}
      </BottomSheet>
      <FileSourcePicker
        open={picker}
        title="Choisir un PDF"
        extensions={["pdf"]}
        multi={false}
        onCancel={() => {
          setPicker(false);
          if (!source) onClose();
        }}
        onConfirm={(p) => {
          setPicker(false);
          if (p[0]) setSource(p[0]);
        }}
      />
      <ProgressDialog
        open={job.running}
        title="Recherche"
        progress={job.progress}
        onCancel={job.cancel}
      />
    </>
  );
}

/* ---------- Text → PDF ---------- */

function TextToPdfSheet({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [name, setName] = useState("document.pdf");
  const [pageSize, setPageSize] = useState<PageSize>("A4");
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [destPicker, setDestPicker] = useState(false);
  const [createdPath, setCreatedPath] = useState<string | null>(null);
  const job = useJob();

  const run = async (d: { rootId: string; segments: string[] }) => {
    const ctrl = job.start();
    const finalName = name.endsWith(".pdf") ? name : `${name}.pdf`;
    const abs = `${toAbsolutePath({ rootId: d.rootId as never, segments: d.segments })}/${finalName}`;
    try {
      const res = await textToPdf(
        text,
        abs,
        { pageSize, orientation },
        { signal: ctrl.signal, onProgress: (p) => job.update(p) },
      );
      recordPdfOp({
        kind: "images-to-pdf" as never,
        summary: "Texte → PDF",
        sources: ["(texte saisi)"],
        outputs: [res.path],
      });
      toast.success("PDF créé", {
        description: `${res.pageCount} page${res.pageCount > 1 ? "s" : ""}, ${formatSize(res.size)}.`,
      });
      setCreatedPath(res.path);
    } catch (e) {
      toast.error(errorMessage(e, "Impossible de terminer l'opération"));
    } finally {
      job.stop();
    }
  };

  return (
    <>
      <BottomSheet
        open={!destPicker && !job.running && !createdPath}
        onClose={onClose}
        title="Créer un PDF depuis du texte"
        footer={
          <>
            <PrimaryButton variant="ghost" onClick={onClose}>
              Fermer
            </PrimaryButton>
            <PrimaryButton
              onClick={() => setDestPicker(true)}
              disabled={!text.trim() || !name.trim()}
            >
              Enregistrer…
            </PrimaryButton>
          </>
        }
      >
        <div className="space-y-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Collez ou saisissez votre texte…"
            className="h-[35vh] w-full rounded-lg border border-border bg-surface p-2 text-[12px]"
          />
          <div className="grid grid-cols-2 gap-2">
            <Select
              label="Format"
              value={pageSize}
              onChange={(v) => setPageSize(v as PageSize)}
              options={[
                ["A4", "A4"],
                ["Letter", "Letter"],
                ["Legal", "Legal"],
                ["A3", "A3"],
                ["A5", "A5"],
              ]}
            />
            <Select
              label="Orientation"
              value={orientation}
              onChange={(v) => setOrientation(v as Orientation)}
              options={[
                ["portrait", "Portrait"],
                ["landscape", "Paysage"],
              ]}
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-muted-foreground">Nom du fichier</label>
            <TextField value={name} onChange={setName} placeholder="document.pdf" />
          </div>
        </div>
      </BottomSheet>
      <DestinationPicker
        open={destPicker}
        title="Enregistrer dans…"
        initial={null}
        onCancel={() => setDestPicker(false)}
        onConfirm={(d) => {
          setDestPicker(false);
          run(d);
        }}
      />
      <ProgressDialog
        open={job.running}
        title="Création PDF"
        progress={job.progress}
        onCancel={job.cancel}
      />
      {createdPath ? (
        <PostCreateActions
          path={createdPath}
          onClose={() => {
            setCreatedPath(null);
            onClose();
          }}
          onPathChanged={setCreatedPath}
        />
      ) : null}
    </>
  );
}

/* ---------- Files → PDF (multi-format converter) ---------- */

function FilesToPdfSheet({ onClose }: { onClose: () => void }) {
  const [sources, setSources] = useState<string[]>([]);
  const [sourcePicker, setSourcePicker] = useState(false);
  const [destPicker, setDestPicker] = useState(false);
  const [merge, setMerge] = useState(false);
  const [baseName, setBaseName] = useState("fusion");
  const [createdPath, setCreatedPath] = useState<string | null>(null);
  const job = useJob();

  const run = async (d: { rootId: string; segments: string[] }) => {
    const ctrl = job.start();
    const dir = toAbsolutePath({ rootId: d.rootId as never, segments: d.segments });
    try {
      const res = await filesToPdf(sources, dir, {
        merge,
        baseName,
        signal: ctrl.signal,
        onProgress: (p) => job.update(p),
      });
      const ok = res.results.filter((r) => r.output && !r.error).length;
      const failed = res.results.filter((r) => r.error);
      recordPdfOp({
        kind: "images-to-pdf" as never,
        summary: `${ok} fichier(s) convertis${res.merged ? " + fusion" : ""}`,
        sources,
        outputs: [
          ...(res.merged ? [res.merged] : []),
          ...res.results.map((r) => r.output).filter((x): x is string => !!x),
        ],
      });
      if (failed.length) {
        toast.warning(
          `${ok} converti(s), ${failed.length} en échec : ${failed
            .slice(0, 3)
            .map((f) => f.error)
            .join(" · ")}`,
        );
      } else {
        toast.success("Conversion terminée", {
          description: `${ok} fichier${ok > 1 ? "s" : ""} converti${ok > 1 ? "s" : ""} en PDF.`,
        });
      }
      const first = res.merged ?? res.results.find((r) => r.output)?.output;
      if (first) setCreatedPath(first);
      else onClose();
    } catch (e) {
      if ((e as Error).name === "AbortError") toast.info("Opération annulée.");
      else toast.error(errorMessage(e, "Impossible de terminer l'opération"));
    } finally {
      job.stop();
    }
  };

  return (
    <>
      <BottomSheet
        open={!sourcePicker && !destPicker && !job.running && !createdPath}
        onClose={onClose}
        title="Convertir en PDF"
        footer={
          <>
            <PrimaryButton variant="ghost" onClick={onClose}>
              Fermer
            </PrimaryButton>
            <PrimaryButton onClick={() => setDestPicker(true)} disabled={sources.length === 0}>
              Convertir…
            </PrimaryButton>
          </>
        }
      >
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => setSourcePicker(true)}
            className="w-full rounded-xl border border-dashed border-border p-4 text-center text-[13px] hover:text-foreground"
          >
            <FilePlus2 className="mx-auto mb-1 h-5 w-5" /> Ajouter des fichiers
          </button>
          <p className="text-[11px] text-muted-foreground">
            Formats supportés : Word (.docx), Excel (.xlsx/.xls), PowerPoint (.pptx), images
            (JPG/PNG/WEBP), texte (.txt/.md/.csv), PDF.
          </p>
          {sources.length > 0 ? (
            <ul className="space-y-1">
              {sources.map((s, i) => (
                <li
                  key={s + i}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2 text-[12px]"
                >
                  <span className="w-5 text-center text-muted-foreground">{i + 1}</span>
                  <span className="flex-1 truncate">{s.split("/").pop()}</span>
                  <button
                    className="px-1 text-muted-foreground"
                    onClick={() => setSources((p) => p.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={merge} onChange={(e) => setMerge(e.target.checked)} />
            Fusionner tous les résultats dans un seul PDF
          </label>
          {merge ? (
            <div>
              <label className="mb-1 block text-[11px] text-muted-foreground">
                Nom du fichier fusionné
              </label>
              <TextField value={baseName} onChange={setBaseName} />
            </div>
          ) : null}
        </div>
      </BottomSheet>
      <FileSourcePicker
        open={sourcePicker}
        title="Choisir des fichiers"
        extensions={[
          "pdf",
          "docx",
          "xlsx",
          "xls",
          "pptx",
          "txt",
          "md",
          "csv",
          "jpg",
          "jpeg",
          "png",
          "webp",
          "gif",
          "bmp",
        ]}
        multi
        onCancel={() => setSourcePicker(false)}
        onConfirm={(paths) => {
          setSourcePicker(false);
          setSources((prev) => [...prev, ...paths]);
        }}
      />
      <DestinationPicker
        open={destPicker}
        title="Enregistrer dans…"
        initial={null}
        onCancel={() => setDestPicker(false)}
        onConfirm={(d) => {
          setDestPicker(false);
          run(d);
        }}
      />
      <ProgressDialog
        open={job.running}
        title="Conversion"
        progress={job.progress}
        onCancel={job.cancel}
      />
      {createdPath ? (
        <PostCreateActions
          path={createdPath}
          onClose={() => {
            setCreatedPath(null);
            onClose();
          }}
          onPathChanged={setCreatedPath}
        />
      ) : null}
    </>
  );
}
