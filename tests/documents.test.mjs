import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { BASE, registerAndLoginCitizen } from "./helpers.mjs";

/**
 * document-service's own multipart upload endpoint, not the JSON /api
 * surface helpers.api() speaks -- gets its own tiny client here, same
 * reasoning as ussd.test.mjs having its own for a different protocol.
 */
async function uploadDocument({ accessToken, entityType, entityId, documentType, filename, mimeType, content }) {
  const form = new FormData();
  form.append("file", new Blob([content], { type: mimeType }), filename);
  form.append("entityType", entityType);
  form.append("entityId", entityId);
  form.append("documentType", documentType);

  const res = await fetch(`${BASE}/documents`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
    body: form,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* no body */
  }
  return { status: res.status, data };
}

describe("document uploads: content validation", () => {
  test("a real PDF (correct magic bytes) uploads successfully", async () => {
    const citizen = await registerAndLoginCitizen("Upload Test User");
    const { status, data } = await uploadDocument({
      accessToken: citizen.accessToken,
      entityType: "birth_certificate",
      entityId: citizen.userId,
      documentType: "SUPPORTING_DOCUMENT",
      filename: "proof.pdf",
      mimeType: "application/pdf",
      content: Buffer.from("%PDF-1.4\n%mock pdf content for testing\n"),
    });
    assert.equal(status, 201);
    assert.ok(data.id);
  });

  test("content that doesn't match the declared MIME type is rejected", async () => {
    const citizen = await registerAndLoginCitizen("Spoofed Upload User");
    const { status, data } = await uploadDocument({
      accessToken: citizen.accessToken,
      entityType: "birth_certificate",
      entityId: citizen.userId,
      documentType: "SUPPORTING_DOCUMENT",
      filename: "fake.pdf",
      mimeType: "application/pdf",
      content: Buffer.from("this is plain text pretending to be a PDF, not real PDF bytes"),
    });
    assert.equal(status, 400);
    assert.equal(data.error, "file_content_does_not_match_declared_type");
  });

  test("a real PNG declared as image/png uploads successfully", async () => {
    const citizen = await registerAndLoginCitizen("PNG Upload User");
    const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const { status } = await uploadDocument({
      accessToken: citizen.accessToken,
      entityType: "trading_license",
      entityId: citizen.userId,
      documentType: "SUPPORTING_DOCUMENT",
      filename: "proof.png",
      mimeType: "image/png",
      content: Buffer.concat([pngSignature, Buffer.from("mock image bytes")]),
    });
    assert.equal(status, 201);
  });

  test("entityType/entityId with path-traversal-shaped characters are rejected", async () => {
    const citizen = await registerAndLoginCitizen("Path Traversal Test User");
    const { status } = await uploadDocument({
      accessToken: citizen.accessToken,
      entityType: "../../etc",
      entityId: citizen.userId,
      documentType: "SUPPORTING_DOCUMENT",
      filename: "proof.pdf",
      mimeType: "application/pdf",
      content: Buffer.from("%PDF-1.4\nmock\n"),
    });
    assert.equal(status, 400);
  });

  test("an unsupported MIME type is rejected regardless of content", async () => {
    const citizen = await registerAndLoginCitizen("Bad MIME Test User");
    const { status, data } = await uploadDocument({
      accessToken: citizen.accessToken,
      entityType: "birth_certificate",
      entityId: citizen.userId,
      documentType: "SUPPORTING_DOCUMENT",
      filename: "script.html",
      mimeType: "text/html",
      content: Buffer.from("<script>alert(1)</script>"),
    });
    assert.equal(status, 400);
    assert.equal(data.error, "unsupported_file_type");
  });
});
