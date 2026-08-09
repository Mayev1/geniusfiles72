/**
 * Transforme un `OrgReport` en `OrgRecommendation` (titre lisible +
 * explication + plan concret). Trie par pertinence : les régressions
 * apparaissent en tête.
 */
import { formatSize } from "@/lib/files/format";
import type { FileEntry, PathRef } from "@/lib/files/types";
import { classify, categoryOf } from "./classifier";
import { proposeBatchRename } from "./renamer";
import type { OrgAction, OrgIssue, OrgPlan, OrgRecommendation, OrgReport } from "./types";

let planCounter = 0;
function makePlan(
  title: string,
  description: string,
  actions: OrgAction[],
  destructive: boolean,
): OrgPlan {
  return {
    id: `plan_${Date.now()}_${++planCounter}`,
    title,
    description,
    actions,
    destructive,
  };
}

function severityRank(s: OrgIssue["severity"]): number {
  return s === "danger" ? 0 : s === "warn" ? 1 : 2;
}

function groupByCategory(
  entries: FileEntry[],
  parent: PathRef,
): Map<string, { catLabel: string; toFolder: string[]; items: FileEntry[] }> {
  const out = new Map<string, { catLabel: string; toFolder: string[]; items: FileEntry[] }>();
  for (const e of entries) {
    const cat = classify(e, parent);
    const info = categoryOf(cat);
    const bucket = out.get(cat) ?? {
      catLabel: info.label,
      toFolder: info.suggestedFolder,
      items: [],
    };
    bucket.items.push(e);
    out.set(cat, bucket);
  }
  return out;
}

export function buildRecommendations(report: OrgReport): OrgRecommendation[] {
  const recs: OrgRecommendation[] = [];
  const sorted = report.issues
    .slice()
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));

  for (const issue of sorted) {
    switch (issue.kind) {
      case "messy_folder": {
        if (!issue.entries || issue.entries.length === 0) break;
        const groups = groupByCategory(issue.entries, issue.path);
        const actions: OrgAction[] = [];
        for (const [catId, g] of groups) {
          if (g.items.length < 2) continue;
          actions.push({
            kind: "group",
            parent: issue.path,
            folderName: g.catLabel,
            entryNames: g.items.map((i) => i.name),
            reason: `Regrouper les ${g.items.length} fichier(s) « ${catId} » dans un sous-dossier « ${g.catLabel} ».`,
          });
        }
        if (actions.length === 0) break;
        recs.push({
          id: `rec_${issue.id}`,
          severity: issue.severity,
          title: `Ranger « ${issue.label} » par catégorie`,
          why: `${issue.detail} Regrouper les fichiers similaires facilite la recherche et le partage.`,
          cta: "Prévisualiser",
          plan: makePlan(
            `Réorganiser ${issue.label}`,
            "Créer un sous-dossier par catégorie détectée et y déplacer les fichiers correspondants.",
            actions,
            true,
          ),
          issueId: issue.id,
        });
        break;
      }
      case "overloaded_folder": {
        recs.push({
          id: `rec_${issue.id}`,
          severity: issue.severity,
          title: `Alléger « ${issue.label} »`,
          why: `${issue.detail} Un dossier de moins de 80 fichiers reste rapide à parcourir.`,
          cta: "Ouvrir le dossier",
          plan: makePlan(
            `Alléger ${issue.label}`,
            "Sélectionner des groupes de fichiers à déplacer manuellement.",
            [],
            false,
          ),
          issueId: issue.id,
        });
        break;
      }
      case "misplaced_file": {
        if (!issue.entries || issue.entries.length === 0) break;
        const groups = groupByCategory(issue.entries, issue.path);
        const actions: OrgAction[] = [];
        for (const [, g] of groups) {
          actions.push({
            kind: "move",
            from: issue.path,
            entryName: g.items[0].name,
            toParent: { rootId: issue.path.rootId, segments: g.toFolder },
            createParent: true,
            reason: `Déplacer vers ${g.catLabel} — plus adapté au contenu.`,
          });
          // Un exemple par catégorie ; l'utilisateur pourra étendre au dossier entier.
        }
        recs.push({
          id: `rec_${issue.id}`,
          severity: issue.severity,
          title: `Déplacer des fichiers hors sujet de « ${issue.label} »`,
          why: `${issue.detail} Chaque fichier est plus facile à retrouver quand il est rangé dans un dossier cohérent.`,
          cta: "Prévisualiser",
          plan: makePlan(
            `Déplacer ${issue.entries.length} fichier(s)`,
            "Déplace les fichiers vers un dossier plus adapté à leur type.",
            actions,
            true,
          ),
          issueId: issue.id,
        });
        break;
      }
      case "unclear_name": {
        if (!issue.entries || issue.entries.length === 0) break;
        const proposals = proposeBatchRename(
          issue.entries.map((e) => ({ entry: e, parent: issue.path })),
        );
        if (proposals.length === 0) break;
        const actions: OrgAction[] = proposals.map((p) => ({
          kind: "rename",
          parent: p.parent,
          from: p.entryName,
          to: p.proposed,
          reason: p.reason,
        }));
        recs.push({
          id: `rec_${issue.id}`,
          severity: issue.severity,
          title: `Renommer ${proposals.length} fichier(s) génériques`,
          why: `${issue.detail} Un nom clair permet de retrouver un fichier sans l'ouvrir.`,
          cta: "Aperçu du renommage",
          plan: makePlan("Renommage intelligent", "Propose des noms lisibles.", actions, true),
          issueId: issue.id,
        });
        break;
      }
      case "isolated_files": {
        if (!issue.entries || issue.entries.length === 0) break;
        const cat = classify(issue.entries[0], issue.path);
        const info = categoryOf(cat);
        recs.push({
          id: `rec_${issue.id}`,
          severity: issue.severity,
          title: `Regrouper ${issue.entries.length} fichier(s) « ${info.label} »`,
          why: `${issue.detail} Un sous-dossier dédié rend l'ensemble immédiatement visible.`,
          cta: "Prévisualiser",
          plan: makePlan(
            `Créer « ${info.label} »`,
            "Crée un sous-dossier dédié et y déplace les fichiers.",
            [
              {
                kind: "group",
                parent: issue.path,
                folderName: info.label,
                entryNames: issue.entries.map((e) => e.name),
                reason: `Sous-dossier « ${info.label} » pour ${issue.entries.length} fichier(s).`,
              },
            ],
            true,
          ),
          issueId: issue.id,
        });
        break;
      }
      case "hard_to_browse":
        recs.push({
          id: `rec_${issue.id}`,
          severity: issue.severity,
          title: "Réorganisation globale recommandée",
          why: `${issue.detail} Un rangement par catégorie majeure réduit la friction au quotidien.`,
          cta: "Voir les priorités",
          plan: makePlan(
            "Réorganisation globale",
            "Un survol des actions les plus impactantes.",
            [],
            false,
          ),
          issueId: issue.id,
        });
        break;
    }
  }

  // Reco « transversale » : distribution + espace réorganisable
  if (report.reorganizableBytes > 0) {
    recs.unshift({
      id: `rec_summary`,
      severity: "info",
      title: `Environ ${formatSize(report.reorganizableBytes)} mieux organisable`,
      why: "Cette estimation additionne l'espace concerné par les recommandations ci-dessous.",
      cta: "Voir les recommandations",
      plan: makePlan("Aperçu", "Récapitulatif du potentiel d'organisation.", [], false),
    });
  }

  return recs;
}
