import type { Response } from "express";

const clients = new Set<Response>();

let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

function ensureKeepAlive() {
  if (keepAliveInterval) return;
  keepAliveInterval = setInterval(() => {
    for (const client of clients) {
      try {
        client.write(":ping\n\n");
      } catch {
        clients.delete(client);
      }
    }
    // Stop interval if no clients remain
    if (clients.size === 0 && keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
  }, 30_000);
}

export function addClient(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  res.write(":ok\n\n");

  clients.add(res);
  ensureKeepAlive();
}

export function removeClient(res: Response): void {
  clients.delete(res);
}

export function broadcast(event: string, data: unknown): void {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    try {
      client.write(payload);
    } catch {
      clients.delete(client);
    }
  }
}

export function getClientCount(): number {
  return clients.size;
}
