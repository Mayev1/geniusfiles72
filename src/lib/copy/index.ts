/**
 * Vocabulaire commun de GeniusFiles.
 *
 * Un seul endroit décide de la façon dont on parle à l'utilisateur :
 * même ton, même vocabulaire, même niveau de simplicité sur chaque écran.
 *
 * Règles appliquées partout :
 *  - phrases courtes, en français, sans terme technique ;
 *  - on dit ce qui se passe, sur quoi, et ce que l'utilisateur peut faire ;
 *  - jamais de code d'erreur, de nom interne ni de message développeur.
 */

/** Accord au pluriel : `plural(3, "fichier")` → « fichiers ». */
export function plural(count: number, singular: string, pluralForm?: string): string {
  if (Math.abs(count) <= 1) return singular;
  return pluralForm ?? `${singular}s`;
}

/** Nombre lisible : 1250 → « 1 250 ». */
export function formatCount(count: number): string {
  return new Intl.NumberFormat("fr-FR").format(count);
}

/** « 1 250 fichiers », « 1 fichier ». */
export function countLabel(count: number, singular: string, pluralForm?: string): string {
  return `${formatCount(count)} ${plural(count, singular, pluralForm)}`;
}

/** Liste lisible : « A, B et C ». */
export function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} et ${items[items.length - 1]}`;
}

/**
 * Étiquette d'une opération en cours.
 * Toujours accompagnée d'un contenu concret : on n'affiche jamais une
 * simple animation de chargement sans dire ce qui se passe.
 *
 * `progressLabel("Déplacement", 12, 45)` → « Déplacement de 12 sur 45 fichiers… »
 */
export function progressLabel(
  action: string,
  done?: number,
  total?: number,
  unit = "fichier",
): string {
  if (typeof total === "number" && total > 0 && typeof done === "number") {
    return `${action} de ${formatCount(done)} sur ${countLabel(total, unit)}…`;
  }
  if (typeof total === "number" && total > 0) {
    return `${action} de ${countLabel(total, unit)}…`;
  }
  return `${action} en cours…`;
}

/**
 * Résumé affiché après une action terminée : un titre court et une ligne
 * de détail qui répond à « qu'est-ce qui a été fait, sur quoi ? ».
 */
export type ActionSummary = { title: string; detail?: string };

export function summarize(
  title: string,
  count: number,
  unit: string,
  destination?: string,
): ActionSummary {
  const base = countLabel(count, unit);
  return {
    title,
    detail: destination ? `${base} vers ${destination}.` : `${base}.`,
  };
}

/** Espace disque lisible pour un résumé : « 2,4 Go libérés ». */
export function freedLabel(bytes: number): string {
  const units = ["octets", "Ko", "Mo", "Go", "To"];
  let value = Math.max(0, bytes);
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  const rounded = i === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString("fr-FR")} ${units[i]}`;
}

/**
 * Textes d'une confirmation avant action sensible.
 * On indique toujours : l'action, les éléments concernés, la conséquence.
 */
export type ConfirmCopy = {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: "default" | "danger";
};

export const confirmCopy = {
  moveToTrash(count: number): ConfirmCopy {
    return {
      title: `Supprimer ${countLabel(count, "fichier")} ?`,
      description:
        count > 1
          ? "Ces fichiers seront déplacés vers la corbeille. Vous pourrez les restaurer tant que la corbeille n'est pas vidée."
          : "Ce fichier sera déplacé vers la corbeille. Vous pourrez le restaurer tant que la corbeille n'est pas vidée.",
      confirmLabel: "Déplacer vers la corbeille",
      tone: "danger",
    };
  },
  deleteForever(count: number): ConfirmCopy {
    return {
      title: `Supprimer définitivement ${countLabel(count, "élément")} ?`,
      description:
        "Cette suppression est définitive : les éléments ne pourront plus être récupérés.",
      confirmLabel: "Supprimer définitivement",
      tone: "danger",
    };
  },
  emptyTrash(count: number): ConfirmCopy {
    return {
      title: "Vider la corbeille ?",
      description: `${countLabel(count, "élément")} ${
        count > 1 ? "seront supprimés" : "sera supprimé"
      } définitivement de votre appareil. Cette action est irréversible.`,
      confirmLabel: "Vider la corbeille",
      tone: "danger",
    };
  },
  move(count: number, destination: string): ConfirmCopy {
    return {
      title: `Déplacer ${countLabel(count, "élément")} ?`,
      description: `${
        count > 1 ? "Ces éléments seront retirés" : "Cet élément sera retiré"
      } de leur emplacement actuel et placés dans « ${destination} ».`,
      confirmLabel: "Déplacer",
    };
  },
  encrypt(count: number): ConfirmCopy {
    return {
      title: `Placer ${countLabel(count, "fichier")} dans le coffre-fort ?`,
      description:
        "Les fichiers seront chiffrés et n'apparaîtront plus dans la galerie ni dans les autres applications. Seul votre code du coffre-fort permettra de les rouvrir.",
      confirmLabel: "Chiffrer et déplacer",
    };
  },
  restore(count: number): ConfirmCopy {
    return {
      title: `Restaurer ${countLabel(count, "élément")} ?`,
      description:
        "Les éléments seront replacés à leur emplacement d'origine. Si un fichier du même nom existe déjà, GeniusFiles vous proposera de le renommer.",
      confirmLabel: "Restaurer",
    };
  },
  clean(freedBytes: number, count: number): ConfirmCopy {
    return {
      title: "Lancer le nettoyage ?",
      description: `${countLabel(count, "élément")} ${
        count > 1 ? "seront supprimés" : "sera supprimé"
      } et environ ${freedLabel(freedBytes)} seront libérés. Seuls les éléments que vous avez cochés sont concernés.`,
      confirmLabel: "Nettoyer",
      tone: "danger",
    };
  },
  overwriteFile(name: string): ConfirmCopy {
    return {
      title: `Remplacer « ${name} » ?`,
      description:
        "Un fichier porte déjà ce nom à cet emplacement. Il sera définitivement remplacé par le nouveau fichier.",
      confirmLabel: "Remplacer",
      tone: "danger",
    };
  },
  deletePages(count: number): ConfirmCopy {
    return {
      title: `Supprimer ${countLabel(count, "page")} ?`,
      description:
        count > 1
          ? "Ces pages seront retirées du nouveau PDF créé. Le fichier d'origine reste inchangé."
          : "Cette page sera retirée du nouveau PDF créé. Le fichier d'origine reste inchangé.",
      confirmLabel: "Supprimer",
      tone: "danger",
    };
  },
  runAutomation(name: string): ConfirmCopy {
    return {
      title: `Exécuter « ${name} » ?`,
      description:
        "GeniusFiles appliquera cette règle maintenant à vos fichiers. Vous verrez le détail des modifications à la fin.",
      confirmLabel: "Exécuter maintenant",
    };
  },
} as const;
