import { Redis } from "ioredis";

const REDIS_URL = process.env.REDIS_URL ?? "redis://redis:6379";
export const EVENT_CHANNEL = "onegov.events";

export interface DomainEvent<T = Record<string, unknown>> {
  name: string;
  occurredAt: string;
  correlationId: string;
  data: T;
}

export function subscribeToEvents(onEvent: (event: DomainEvent) => void): void {
  const subscriber = new Redis(REDIS_URL);
  subscriber.subscribe(EVENT_CHANNEL, (err: Error | null | undefined) => {
    if (err) console.error("[eventBus] failed to subscribe", err.message);
  });
  subscriber.on("message", (_channel: string, message: string) => {
    try {
      onEvent(JSON.parse(message) as DomainEvent);
    } catch (err) {
      console.error("[eventBus] failed to parse event", (err as Error).message);
    }
  });
}
