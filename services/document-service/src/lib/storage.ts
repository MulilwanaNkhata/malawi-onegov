import { Client } from "minio";

/** Used for actual object operations (put/stat) -- reachable only from inside the Docker network. */
export const minioClient = new Client({
  endPoint: process.env.MINIO_ENDPOINT ?? "minio",
  port: Number(process.env.MINIO_PORT ?? 9000),
  useSSL: process.env.MINIO_USE_SSL === "true",
  accessKey: process.env.MINIO_ACCESS_KEY ?? "onegov",
  secretKey: process.env.MINIO_SECRET_KEY ?? "onegov-secret",
});

/**
 * Used only to mint presigned URLs. AWS SigV4 presigned URLs sign the `Host`
 * header, so a URL signed against the internal Docker hostname ("minio")
 * would carry that host in its signature and fail validation when a
 * browser -- which can't resolve "minio" at all -- requests it directly.
 * This client signs against the same host:port the browser will actually
 * use, while object operations above still go over the internal network.
 *
 * Its "endPoint" is never actually connected to for this: signing a
 * presigned URL is a pure local computation, but the minio SDK will first
 * try to look up the bucket's region over the network unless it's told the
 * region up front -- which, pointed at a host with nothing listening (e.g.
 * "localhost" from inside this container), throws ECONNREFUSED. Passing the
 * region explicitly skips that lookup entirely.
 */
const publicMinioClient = new Client({
  endPoint: process.env.MINIO_PUBLIC_ENDPOINT ?? "localhost",
  port: Number(process.env.MINIO_PUBLIC_PORT ?? 9000),
  useSSL: process.env.MINIO_PUBLIC_USE_SSL === "true",
  region: process.env.MINIO_REGION ?? "us-east-1",
  accessKey: process.env.MINIO_ACCESS_KEY ?? "onegov",
  secretKey: process.env.MINIO_SECRET_KEY ?? "onegov-secret",
});

export const BUCKET = process.env.MINIO_BUCKET ?? "onegov-documents";

/** Short-lived signed URL -- nothing in the document wallet is ever public. */
export async function presignedDownloadUrl(storageKey: string, expirySeconds = 900): Promise<string> {
  return publicMinioClient.presignedGetObject(BUCKET, storageKey, expirySeconds);
}
