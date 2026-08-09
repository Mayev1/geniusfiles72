/**
 * Transfert entre appareils — contrats.
 *
 * Le module fonctionne offline (Wi-Fi local / hotspot / Bluetooth / Wi-Fi Direct
 * quand disponibles) et pose les fondations pour l'ajout ultérieur de :
 *   - transfert vers plusieurs appareils simultanément
 *   - synchronisation entre appareils
 *   - transfert automatique de dossiers
 *   - partage sécurisé avec expiration
 *   - transfert via Internet lorsque les appareils sont éloignés
 *   - suggestions IA
 *   - reprise avancée après interruption
 *
 * Les types ci-dessous sont volontairement stables pour absorber ces
 * évolutions sans casser l'UI.
 */

export type TransportKind = "wifi-lan" | "wifi-direct" | "hotspot" | "bluetooth" | "internet";

export interface DeviceInfo {
  id: string;
  name: string;
  platform: "android" | "ios" | "windows" | "macos" | "linux" | "web" | "unknown";
  transport: TransportKind;
  address?: string;
  /** Force du signal / qualité de lien (0-1). */
  signal?: number;
  /** Découvert automatiquement (mDNS, WiFi-Direct...) vs ajouté manuellement. */
  discovered: boolean;
  lastSeen: number;
}

export type ConflictPolicy = "rename" | "replace" | "keep-both" | "skip" | "ask";

export interface TransferItem {
  /** Chemin absolu ou identifiant logique de la source. */
  source: string;
  /** Nom relatif (préservant l'arborescence pour les dossiers). */
  relPath: string;
  size: number;
  isDirectory: boolean;
  /** Empreinte SHA-256 hex (calculée à l'envoi, vérifiée à la réception). */
  checksum?: string;
}

export type SessionRole = "sender" | "receiver";

export type SessionState =
  | "preparing"
  | "waiting-peer"
  | "handshaking"
  | "running"
  | "paused"
  | "verifying"
  | "completed"
  | "cancelled"
  | "failed"
  | "reconnecting";

export interface TransferPlan {
  items: TransferItem[];
  totalFiles: number;
  totalBytes: number;
  destinationDeviceId: string;
  destinationDeviceName: string;
  /** Emplacement d'enregistrement prévu côté récepteur (peut être ajusté). */
  destinationPath: string;
  conflictPolicy: ConflictPolicy;
  /** Vérification par checksum SHA-256 activée. */
  verify: boolean;
}

export interface TransferProgress {
  state: SessionState;
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  bytesPerSecond: number;
  etaSeconds: number;
  currentFile?: string;
  currentFileBytesDone?: number;
  currentFileBytesTotal?: number;
  message?: string;
}

export interface TransferSession {
  id: string;
  role: SessionRole;
  peer: DeviceInfo;
  plan: TransferPlan;
  progress: TransferProgress;
  startedAt: number;
  endedAt?: number;
  /**
   * Reprise : offset atteint par fichier au moment d'une coupure, pour
   * pouvoir redémarrer sans repartir de zéro.
   */
  resumeCheckpoints?: Record<string, number>;
  /**
   * Récepteur uniquement : liste des fichiers effectivement reçus, dans
   * l'ordre d'arrivée. Sert à la vue "Voir les fichiers transférés".
   */
  receivedFiles?: Array<{ name: string; size: number; path: string }>;
}

export interface HistoryEntry {
  id: string;
  role: SessionRole;
  peerName: string;
  peerPlatform: DeviceInfo["platform"];
  transport: TransportKind;
  filesCount: number;
  totalBytes: number;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  status: "success" | "cancelled" | "failed";
  verified: boolean;
  destinationPath?: string;
  errorMessage?: string;
}

export interface TransferFoundations {
  /** Transfert vers plusieurs appareils simultanément. */
  multiTarget: boolean;
  /** Synchronisation entre appareils. */
  sync: boolean;
  /** Transfert automatique de dossiers. */
  autoFolder: boolean;
  /** Partage sécurisé avec expiration. */
  expiringShare: boolean;
  /** Transfert via Internet (appareils éloignés). */
  relayInternet: boolean;
  /** Suggestions IA. */
  aiSuggestions: boolean;
  /** Reprise avancée des transferts interrompus. */
  advancedResume: boolean;
}

export const TRANSFER_FOUNDATIONS: readonly {
  key: keyof TransferFoundations;
  label: string;
  desc: string;
}[] = [
  {
    key: "multiTarget",
    label: "Envoi vers plusieurs appareils",
    desc: "Diffuser un même lot vers un groupe d'appareils simultanément.",
  },
  {
    key: "sync",
    label: "Synchronisation entre appareils",
    desc: "Garder deux dossiers en miroir sur deux appareils.",
  },
  {
    key: "autoFolder",
    label: "Transfert automatique de dossiers",
    desc: "Déclencher un envoi dès qu'un fichier arrive dans un dossier surveillé.",
  },
  {
    key: "expiringShare",
    label: "Partage sécurisé avec expiration",
    desc: "Lien à durée limitée, protégé et révocable.",
  },
  {
    key: "relayInternet",
    label: "Transfert à distance via Internet",
    desc: "Relais chiffré quand les appareils ne sont pas sur le même réseau.",
  },
  {
    key: "aiSuggestions",
    label: "Suggestions intelligentes de partage",
    desc: "L'IA propose les meilleurs fichiers et destinataires.",
  },
  {
    key: "advancedResume",
    label: "Reprise avancée des transferts",
    desc: "Reprise fine par bloc après coupure, même longue.",
  },
] as const;
