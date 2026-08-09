/**
 * Sélection d'un fichier local (image ou audio) pour les calques.
 *
 * Sur Android, le sélecteur système renvoie un chemin réellement lisible
 * par le moteur d'export (le fichier est recopié dans le cache de
 * l'application si son URI n'est pas un chemin direct). Hors Android, la
 * fonction échoue explicitement plutôt que de laisser croire à un import
 * qui ne pourrait pas être exporté.
 */
import { isAndroidNative, nativePlugin } from "@/lib/native/geniusfiles-native";
import { Capacitor } from "@capacitor/core";

export type PickedFile = { path: string; name: string; size: number; previewUrl: string };

export async function pickLocalFile(mime: string): Promise<PickedFile> {
  const p = nativePlugin();
  if (!isAndroidNative() || !p?.pickLocalFile) {
    throw new Error("L'import de fichiers nécessite l'application Android.");
  }
  const res = await p.pickLocalFile({ mime });
  return {
    path: res.path,
    name: res.name,
    size: res.size,
    previewUrl: Capacitor.convertFileSrc(res.path),
  };
}
