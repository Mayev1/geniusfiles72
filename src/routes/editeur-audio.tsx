import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AudioEditor } from "@/components/audio/AudioEditor";
import { kindOf } from "@/lib/files/format";
import type { FileEntry, PathRef, StorageRootId } from "@/lib/files/types";

type Search = { root: string; dir: string; name: string };

export const Route = createFileRoute("/editeur-audio")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    root: typeof s.root === "string" && s.root ? s.root : "internal",
    dir: typeof s.dir === "string" ? s.dir : "",
    name: typeof s.name === "string" ? s.name : "",
  }),
  head: () => ({
    meta: [
      { title: "Éditeur audio — GeniusFiles" },
      {
        name: "description",
        content:
          "Découpez, ajustez le volume, les fondus, la vitesse et exportez vos fichiers audio sans perte.",
      },
      { property: "og:title", content: "Éditeur audio — GeniusFiles" },
      {
        property: "og:description",
        content: "Éditeur audio non destructif intégré au gestionnaire de fichiers GeniusFiles.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AudioEditorRoute,
});

function AudioEditorRoute() {
  const { root, dir, name } = Route.useSearch();
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
        Aucun fichier audio sélectionné.
      </div>
    );
  }
  return <AudioEditor parent={parent} entry={entry} onExit={() => void navigate({ to: "/" })} />;
}
