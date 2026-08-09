import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { VideoEditor } from "@/components/video/VideoEditor";
import { kindOf } from "@/lib/files/format";
import type { FileEntry, PathRef, StorageRootId } from "@/lib/files/types";

type Search = { root: string; dir: string; name: string; t: number };

export const Route = createFileRoute("/editeur-video")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    root: typeof s.root === "string" && s.root ? s.root : "internal",
    dir: typeof s.dir === "string" ? s.dir : "",
    name: typeof s.name === "string" ? s.name : "",
    t: typeof s.t === "number" && Number.isFinite(s.t) ? s.t : 0,
  }),
  head: () => ({
    meta: [
      { title: "Éditeur vidéo — GeniusFiles" },
      {
        name: "description",
        content:
          "Découpez, transformez et exportez vos vidéos directement dans GeniusFiles, sans application externe.",
      },
      { property: "og:title", content: "Éditeur vidéo — GeniusFiles" },
      {
        property: "og:description",
        content: "Module d'édition vidéo intégré au gestionnaire de fichiers GeniusFiles.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VideoEditorRoute,
});

function VideoEditorRoute() {
  const { root, dir, name, t } = Route.useSearch();
  const navigate = useNavigate();
  const segments = dir.split("/").filter(Boolean);
  const parent: PathRef = { rootId: root as StorageRootId, segments };
  const entry: FileEntry = {
    name,
    path: [...segments, name].join("/"),
    isDirectory: false,
    kind: kindOf(name, false),
    ext: name.includes(".") ? name.split(".").pop()!.toLowerCase() : undefined,
  };
  if (!name) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-[13px] text-muted-foreground">
        Aucune vidéo sélectionnée.
      </div>
    );
  }
  return (
    <VideoEditor
      parent={parent}
      entry={entry}
      startAt={t / 1000}
      onExit={() => void navigate({ to: "/" })}
    />
  );
}
