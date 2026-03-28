import { Router, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { logger } from "../logger.js";

const router = Router();

// Base path for folder browsing — set via HOST_HOME_MOUNT env var (Docker mount point)
// or falls back to /host-home
const HOST_HOME_MOUNT = process.env.HOST_HOME_MOUNT || "/host-home";

// Directories to hide from the folder picker
const HIDDEN_DIRS = new Set([
  "AppData",
  "Application Data",
  "Local Settings",
  "MicrosoftEdgeBackups",
  "NetHood",
  "PrintHood",
  "Recent",
  "SendTo",
  "Start Menu",
  "Templates",
  "Cookies",
  "ntuser.dat",
  "NTUSER.DAT",
  "ntuser.ini",
  "$Recycle.Bin",
  "node_modules",
  ".cache",
  ".npm",
  ".nuget",
  ".vscode-server",
  "__pycache__",
  ".git",
  "All Users",
  "Default",
  "Default User",
  "Public",
]);

function isHidden(name: string): boolean {
  if (HIDDEN_DIRS.has(name)) return true;
  if (name.startsWith(".") && name !== ".claude") return true;
  if (name.startsWith("$")) return true;
  return false;
}

// GET /api/folders?path=<relative-path>
// Lists subdirectories under the user's home folder
router.get("/", (req: Request, res: Response) => {
  try {
    const requestedPath = (req.query.path as string) || "";

    // Resolve to absolute path under the mount point
    const resolved = path.resolve(HOST_HOME_MOUNT, requestedPath);

    // Security: ensure we stay within the mount point
    if (!resolved.startsWith(HOST_HOME_MOUNT)) {
      res.status(403).json({ error: "Access denied: path outside user home" });
      return;
    }

    // Check if directory exists
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      res.status(404).json({ error: "Directory not found" });
      return;
    }

    // Read directory entries
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    const folders = entries
      .filter((e) => {
        if (!e.isDirectory()) return false;
        if (isHidden(e.name)) return false;
        return true;
      })
      .map((e) => {
        const fullPath = path.join(resolved, e.name);
        const relativePath = path.relative(HOST_HOME_MOUNT, fullPath);
        let hasChildren = false;
        try {
          const children = fs.readdirSync(fullPath, { withFileTypes: true });
          hasChildren = children.some((c) => c.isDirectory() && !isHidden(c.name));
        } catch {
          // Permission denied — no children
        }
        return {
          name: e.name,
          path: relativePath.replace(/\\/g, "/"),
          hasChildren,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      current: requestedPath || "",
      folders,
    });
  } catch (err) {
    logger.error({ err }, "Error browsing folders");
    res.status(500).json({ error: "Failed to browse folders" });
  }
});

export default router;
