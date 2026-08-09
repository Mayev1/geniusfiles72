/**
 * Traduction des erreurs techniques en messages compréhensibles.
 *
 * Objectif : plus jamais « Erreur inconnue » ni « Operation failed ».
 * Chaque message explique *ce qui s'est passé* et *ce que l'utilisateur
 * peut faire ensuite*, en français, sans jargon.
 */

export type FriendlyError = {
  /** Titre court, affichable dans un toast. */
  title: string;
  /** Piste de résolution concrète. */
  hint?: string;
};

type Rule = { test: RegExp; error: FriendlyError };

const RULES: Rule[] = [
  {
    test: /permission|denied|EACCES|MANAGE_EXTERNAL_STORAGE|SAF/i,
    error: {
      title: "Accès au dossier refusé",
      hint: "Autorisez « Tous les fichiers » pour GeniusFiles dans les réglages Android.",
    },
  },
  {
    test: /ENOSPC|no space|storage full|quota/i,
    error: {
      title: "Espace de stockage insuffisant",
      hint: "Libérez de la place avec le Nettoyeur, puis réessayez.",
    },
  },
  {
    test: /EXISTS|already exists|file exists/i,
    error: {
      title: "Ce nom existe déjà",
      hint: "Choisissez un autre nom ou remplacez l'élément existant.",
    },
  },
  {
    test: /NOT_FOUND|ENOENT|no such file/i,
    error: {
      title: "Fichier introuvable",
      hint: "Il a peut-être été déplacé ou supprimé. Actualisez la liste.",
    },
  },
  {
    test: /EBUSY|in use|locked/i,
    error: {
      title: "Fichier en cours d'utilisation",
      hint: "Fermez l'application qui l'utilise, puis réessayez.",
    },
  },
  {
    test: /READ_ONLY|EROFS/i,
    error: {
      title: "Stockage en lecture seule",
      hint: "Choisissez une destination sur la mémoire interne.",
    },
  },
  {
    test: /network|fetch failed|ERR_INTERNET|offline|ENOTFOUND|timeout/i,
    error: {
      title: "Connexion indisponible",
      hint: "Cette action nécessite Internet. Les fonctions locales restent utilisables.",
    },
  },
  {
    test: /abort|cancel/i,
    error: { title: "Opération annulée" },
  },
  {
    test: /plugin|bridge|native/i,
    error: {
      title: "Fonction indisponible ici",
      hint: "Cette action nécessite l'application Android installée sur l'appareil.",
    },
  },
  {
    test: /invalid name|nom invalide/i,
    error: {
      title: "Nom invalide",
      hint: "Évitez les caractères « / » et « \\ ».",
    },
  },
  {
    test: /password|mot de passe|encrypted|chiffr/i,
    error: {
      title: "Ce document est protégé par un mot de passe",
      hint: "Saisissez le mot de passe du document, puis réessayez.",
    },
  },
  {
    test: /corrupt|malformed|damaged|invalid pdf|bad xref|unexpected end/i,
    error: {
      title: "Ce fichier semble endommagé",
      hint: "Il ne peut pas être ouvert. Essayez avec une autre copie du fichier.",
    },
  },
  {
    test: /unsupported|not supported|unknown format|mime/i,
    error: {
      title: "Format non pris en charge",
      hint: "GeniusFiles ne sait pas encore ouvrir ce type de fichier.",
    },
  },
  {
    test: /rate.?limit|429|quota exceeded|credit/i,
    error: {
      title: "Trop de demandes en peu de temps",
      hint: "Patientez quelques instants avant de relancer l'opération.",
    },
  },
  {
    test: /out of memory|allocation|too large|maximum size/i,
    error: {
      title: "Fichier trop volumineux",
      hint: "Traitez-le en plusieurs parties ou fermez les autres applications, puis réessayez.",
    },
  },
];

/** Convertit n'importe quelle erreur en message clair pour l'utilisateur. */
export function humanizeError(err: unknown, fallbackTitle = "Action impossible"): FriendlyError {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : err && typeof err === "object" && "message" in err
          ? String((err as { message: unknown }).message)
          : "";

  for (const rule of RULES) {
    if (rule.test.test(raw)) return rule.error;
  }
  // Message déjà rédigé en français lisible : on le conserve tel quel.
  if (raw && /^[A-ZÀ-Ÿ][^A-Z_]{4,}/.test(raw) && !/[_]{1,}|failed|error/i.test(raw)) {
    return { title: raw };
  }
  return {
    title: fallbackTitle,
    hint: "Réessayez ; si le problème persiste, vérifiez l'espace disponible et les autorisations.",
  };
}

/** Version aplatie, pratique pour un toast à une ligne. */
export function errorMessage(err: unknown, fallbackTitle?: string): string {
  const f = humanizeError(err, fallbackTitle);
  return f.hint ? `${f.title} — ${f.hint}` : f.title;
}

/**
 * Résumé lisible d'une opération par lot :
 * « 12 fichiers copiés » / « 10 copiés, 2 impossibles ».
 */
export function batchSummary(
  verbPast: string,
  succeeded: number,
  failed: number,
): { ok: boolean; message: string } {
  if (failed === 0) {
    return { ok: true, message: `${succeeded} élément${succeeded > 1 ? "s" : ""} ${verbPast}` };
  }
  if (succeeded === 0) {
    return {
      ok: false,
      message: `Aucun élément ${verbPast} — ${failed} en échec. Vérifiez les autorisations et l'espace disponible.`,
    };
  }
  return {
    ok: false,
    message: `${succeeded} ${verbPast}, ${failed} impossible${failed > 1 ? "s" : ""}`,
  };
}
