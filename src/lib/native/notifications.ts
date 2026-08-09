/**
 * Fine wrapper around the native `showLocalNotification` method exposed by
 * `GeniusFilesNativePlugin`. Off-native (web preview) the call is a no-op —
 * callers already display an in-app toast, so nothing is lost.
 *
 * This module intentionally never throws: notifications are a *nice to have*
 * around real work; a permission miss must not break the automation itself.
 */
import { nativePlugin, isAndroidNative } from "./geniusfiles-native";

type NotifyPlugin = {
  showLocalNotification?: (opts: {
    id?: number;
    title: string;
    body: string;
    route?: string;
    channelId?: string;
    channelName?: string;
  }) => Promise<{ posted: boolean; id: number }>;
  requestNotificationPermission?: () => Promise<{ granted: boolean }>;
};

function plugin(): NotifyPlugin | null {
  return nativePlugin() as unknown as NotifyPlugin | null;
}

export function isNotificationsAvailable(): boolean {
  return isAndroidNative() && typeof plugin()?.showLocalNotification === "function";
}

let requested = false;
export async function ensureNotificationPermission(): Promise<void> {
  if (requested) return;
  requested = true;
  const p = plugin();
  if (!p?.requestNotificationPermission) return;
  try {
    await p.requestNotificationPermission();
  } catch {
    /* ignore */
  }
}

export async function showNotification(opts: {
  id?: number;
  title: string;
  body: string;
  route?: string;
}): Promise<void> {
  const p = plugin();
  if (!p?.showLocalNotification) return;
  try {
    await p.showLocalNotification({
      id: opts.id,
      title: opts.title,
      body: opts.body,
      route: opts.route ?? "/automatisations",
      channelId: "gf_automations",
      channelName: "Automatisations",
    });
  } catch {
    /* silently ignore — the toast in the UI still confirms success */
  }
}
