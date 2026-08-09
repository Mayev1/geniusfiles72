/**
 * Bouton Retour de l'interface. Il délègue au contrôleur unique de
 * navigation : même comportement que le bouton système et le geste.
 */
import { ArrowLeft } from "lucide-react";
import { useAppBack } from "@/lib/navigation/use-app-back";

export function BackButton({ className, size = 16 }: { className?: string; size?: number }) {
  const goBack = useAppBack();
  return (
    <button
      type="button"
      onClick={goBack}
      aria-label="Retour"
      className={
        className ??
        "rounded-lg border border-border bg-surface p-1.5 text-muted-foreground transition-colors hover:text-foreground"
      }
    >
      <ArrowLeft style={{ height: size, width: size }} />
    </button>
  );
}
