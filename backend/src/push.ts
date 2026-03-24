import webpush from "web-push";
import { getSetting, setSetting, getAllPushSubscriptions, removePushSubscription } from "./db.js";

let initialized = false;

export function initPush(): void {
  if (initialized) return;

  let publicKey = getSetting("vapid_public_key");
  let privateKey = getSetting("vapid_private_key");

  if (!publicKey || !privateKey) {
    const keys = webpush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    setSetting("vapid_public_key", publicKey);
    setSetting("vapid_private_key", privateKey);
    console.log("Generated new VAPID keys");
  }

  webpush.setVapidDetails(
    "mailto:agent-manager@localhost",
    publicKey,
    privateKey
  );

  initialized = true;
  console.log("Web Push initialized");
}

export function getVapidPublicKey(): string {
  const key = getSetting("vapid_public_key");
  if (!key) throw new Error("VAPID keys not initialized");
  return key;
}

export async function sendPushToAll(title: string, body: string, url?: string): Promise<void> {
  const subscriptions = getAllPushSubscriptions();
  if (subscriptions.length === 0) return;

  const payload = JSON.stringify({
    title,
    body,
    url: url || "/",
  });

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
        },
        payload
      )
    )
  );

  // Clean up expired/invalid subscriptions
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "rejected") {
      const err = result.reason as { statusCode?: number };
      if (err.statusCode === 410 || err.statusCode === 404) {
        removePushSubscription(subscriptions[i].endpoint);
        console.log("Removed expired push subscription");
      } else {
        console.error("Push notification failed:", result.reason);
      }
    }
  }
}
