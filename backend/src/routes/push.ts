import { Router, type Request, type Response } from "express";
import { addPushSubscription, removePushSubscription } from "../db.js";
import { getVapidPublicKey } from "../push.js";

const router = Router();

// GET /vapid-public-key — return the VAPID public key for the frontend
router.get("/vapid-public-key", (_req: Request, res: Response) => {
  try {
    const key = getVapidPublicKey();
    res.json({ publicKey: key });
  } catch (err) {
    console.error("Error getting VAPID key:", err);
    res.status(500).json({ error: "VAPID keys not available" });
  }
});

// POST /subscribe — save a push subscription
router.post("/subscribe", (req: Request, res: Response) => {
  try {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      res.status(400).json({ error: "Invalid subscription: endpoint and keys (p256dh, auth) required" });
      return;
    }

    addPushSubscription(endpoint, keys.p256dh, keys.auth);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error saving push subscription:", err);
    res.status(500).json({ error: "Failed to save subscription" });
  }
});

// POST /unsubscribe — remove a push subscription
router.post("/unsubscribe", (req: Request, res: Response) => {
  try {
    const { endpoint } = req.body;
    if (!endpoint) {
      res.status(400).json({ error: "endpoint is required" });
      return;
    }

    removePushSubscription(endpoint);
    res.json({ ok: true });
  } catch (err) {
    console.error("Error removing push subscription:", err);
    res.status(500).json({ error: "Failed to remove subscription" });
  }
});

export default router;
