import { Redis } from "ioredis";
import { randomUUID } from "crypto";

const REDIS_URL = process.env.REDIS_URL ?? "redis://redis:6379";
export const EVENT_CHANNEL = "onegov.events";

const publisher = new Redis(REDIS_URL);

export async function publishEvent<T>(name: string, data: T, correlationId = randomUUID()): Promise<void> {
  const event = { name, occurredAt: new Date().toISOString(), correlationId, data };
  await publisher.publish(EVENT_CHANNEL, JSON.stringify(event));
}
