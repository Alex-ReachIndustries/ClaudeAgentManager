import { Router, type Request, type Response } from "express";
import { addPushSubscription, removePushSubscription } from "../db.js";
import { getVapidPublicKey } from "../push.js";
import { validate } from "../middleware/validate.js";
import { pushSubscribeSchema, pushUnsubscribeSchema } from "../schemas.js";
import { logger } from "../logger.js";

const router = Router();

router.get("/vapid-public-key", (_req: Request, res: Response) => {
  try {
    const key = getVapidPublicKey();
    res.json({ publicKey: key });
  } catch (err) {
    logger.error({ err }, "Error getting VAPID key");
    res.status(500).json({ error: "VAPID keys not available" });
  }
});

router.post("/subscribe", validate(pushSubscribeSchema), (req: Request, res: Response) => {
  try {
    const { endpoint, keys } = req.body;
    addPushSubscription(endpoint, keys.p256dh, keys.auth);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error saving push subscription");
    res.status(500).json({ error: "Failed to save subscription" });
  }
});

router.post("/unsubscribe", validate(pushUnsubscribeSchema), (req: Request, res: Response) => {
  try {
    const { endpoint } = req.body;
    removePushSubscription(endpoint);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "Error removing push subscription");
    res.status(500).json({ error: "Failed to remove subscription" });
  }
});

export default router;
