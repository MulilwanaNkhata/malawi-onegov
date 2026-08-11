import { Redis } from "ioredis";
import { randomUUID } from "crypto";

const REDIS_URL = process.env.REDIS_URL ?? "redis://redis:6379";
export const EVENT_CHANNEL = "onegov.events";

export interface DomainEvent<T = Record<string, unknown>> {
  name: string;
  occurredAt: string;
  correlationId: string;
  data: T;
}

const publisher = new Redis(REDIS_URL);

export async function publishEvent<T>(name: string, data: T, correlationId = randomUUID()): Promise<void> {
  const event: DomainEvent<T> = { name, occurredAt: new Date().toISOString(), correlationId, data };
  await publisher.publish(EVENT_CHANNEL, JSON.stringify(event));
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
