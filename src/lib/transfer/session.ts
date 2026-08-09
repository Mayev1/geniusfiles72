/**
 * Session de transfert — génération d'identifiants, codes courts et
 * charge utile QR unique pour CHAQUE session.
 *
 * Le QR encode désormais l'adresse réseau réelle de l'expéditeur (host+port)
 * pour que le récepteur puisse se connecter directement, sans dépendre d'une
 * découverte mDNS. Le code court à 6 chiffres reste utilisé comme secours
 * (saisie manuelle) et comme identifiant de service mDNS pour l'appairage
 * automatique à proximité.
 *
 * Rien n'est mémorisé ni ré-utilisé : chaque appel crée une nouvelle
 * session et invalide implicitement la précédente. Aucun QR/code fictif
 * n'est jamais stocké.
 */
import { getIdentity, getLocalName, setLocalName } from "./identity";
import type { DeviceInfo, TransferPlan, TransportKind } from "./types";

export interface OutgoingSession {
  /** Identifiant unique de session (32 bits random + horodatage). */
  id: string;
  /** Code court (6 chiffres) affiché à l'utilisateur. */
  code: string;
  /** Nom local de l'appareil, utilisé pour se présenter à l'autre. */
  localName: string;
  /** UUID stable de l'appareil local (pour désambiguïser deux noms identiques). */
  localDeviceId: string;
  /** Adresse réseau exposée par le plugin natif (une fois le serveur ouvert). */
  host?: string;
  port?: number;
  /** Charge utile encodée dans le QR : URL `gf-transfer://send?…`. */
  qrPayload: string;
  /** Horodatage de création — sert à faire expirer la session. */
  createdAt: number;
  /** Plan associé (nb fichiers, taille totale, items). */
  plan: TransferPlan;
}

export interface IncomingSessionInvite {
  id: string;
  code?: string;
  senderName: string;
  senderDeviceId?: string;
  filesCount?: number;
  totalBytes?: number;
  /** Adresse au format host:port (raccourci pratique pour l'UI). */
  address?: string;
  host?: string;
  port?: number;
  transport: TransportKind;
}

/**
 * Nom de l'appareil local. Utilise le module `identity` — plus aucun
 * fallback "Mon appareil" générique en production : la première ouverture
 * génère un nom unique lisible (ex. « Genius_A7K92 »).
 */
export function getLocalDeviceName(): string {
  return getLocalName();
}

export function setLocalDeviceName(name: string) {
  setLocalName(name);
}

function randomId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `s_${Date.now().toString(36)}_${rand}`;
}

function randomCode(): string {
  const n =
    typeof crypto !== "undefined"
      ? (crypto.getRandomValues(new Uint32Array(1))[0] % 900000) + 100000
      : Math.floor(100000 + Math.random() * 900000);
  return String(n);
}

function buildPayload(o: {
  id: string;
  code: string;
  name: string;
  deviceId: string;
  files: number;
  bytes: number;
  host?: string;
  port?: number;
}): string {
  const p = new URLSearchParams({
    id: o.id,
    c: o.code,
    n: o.name,
    d: o.deviceId,
    f: String(o.files),
    b: String(o.bytes),
  });
  if (o.host) p.set("h", o.host);
  if (o.port && o.port > 0) p.set("p", String(o.port));
  return `gf-transfer://send?${p.toString()}`;
}

/**
 * Crée une nouvelle session sortante. Le QR et le code générés sont
 * uniques et différents à chaque appel. À ce stade, le serveur natif
 * n'est PAS encore ouvert : appelez ensuite `attachHostToSession` avec
 * l'adresse retournée par le plugin natif pour que le QR contienne un
 * point de rendez-vous exploitable.
 */
export function createOutgoingSession(plan: TransferPlan): OutgoingSession {
  const id = randomId();
  const code = randomCode();
  const { name, deviceId } = getIdentity();
  return {
    id,
    code,
    localName: name,
    localDeviceId: deviceId,
    qrPayload: buildPayload({
      id,
      code,
      name,
      deviceId,
      files: plan.totalFiles,
      bytes: plan.totalBytes,
    }),
    createdAt: Date.now(),
    plan,
  };
}

/** Injecte l'adresse réseau réelle dans une session et regénère son QR. */
export function attachHostToSession(
  session: OutgoingSession,
  host: string,
  port: number,
): OutgoingSession {
  return {
    ...session,
    host,
    port,
    qrPayload: buildPayload({
      id: session.id,
      code: session.code,
      name: session.localName,
      deviceId: session.localDeviceId,
      files: session.plan.totalFiles,
      bytes: session.plan.totalBytes,
      host,
      port,
    }),
  };
}

/** Parse un QR reçu par le destinataire. Retourne null si invalide. */
export function parseIncomingInvite(raw: string): IncomingSessionInvite | null {
  const text = raw.trim();
  if (!text) return null;

  // Nouveau format (gf-transfer://send?…) — contient host+port lorsque
  // l'expéditeur a déjà ouvert son serveur.
  try {
    if (text.startsWith("gf-transfer://")) {
      const url = new URL(text);
      const id = url.searchParams.get("id");
      if (!id) return null;
      const host = url.searchParams.get("h") ?? undefined;
      const port = numOrUndef(url.searchParams.get("p"));
      return {
        id,
        code: url.searchParams.get("c") ?? undefined,
        senderName: url.searchParams.get("n") ?? "Appareil distant",
        senderDeviceId: url.searchParams.get("d") ?? undefined,
        filesCount: numOrUndef(url.searchParams.get("f")),
        totalBytes: numOrUndef(url.searchParams.get("b")),
        host,
        port,
        address: host && port ? `${host}:${port}` : undefined,
        transport: "wifi-lan",
      };
    }
  } catch {
    /* fallthrough */
  }

  // Format court : « 6 chiffres ». Ne contient pas d'adresse — la
  // résolution passe par la découverte mDNS filtrée par code.
  if (/^\d{4,8}$/.test(text)) {
    return {
      id: `code_${text}`,
      code: text,
      senderName: "Appareil distant",
      transport: "wifi-lan",
    };
  }

  return null;
}

function numOrUndef(v: string | null): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Construit un `DeviceInfo` provisoire à partir d'une invitation reçue.
 */
export function inviteToDevice(invite: IncomingSessionInvite): DeviceInfo {
  const address =
    invite.address ?? (invite.host && invite.port ? `${invite.host}:${invite.port}` : invite.host);
  return {
    id: invite.senderDeviceId ?? invite.id,
    name: invite.senderName,
    platform: "android",
    transport: invite.transport,
    address,
    discovered: true,
    signal: 1,
    lastSeen: Date.now(),
  };
}
