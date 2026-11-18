import assert from "node:assert/strict";
import { argon2Sync } from "node:crypto";
import { describe, it } from "node:test";
import { dummyPasswordHash, hashPassword, needsRehash, verifyPassword } from "../src/utils/password";
import { generateToken, hashToken } from "../src/utils/token";

describe("Argon2id (node:crypto)", () => {
  it("matches the RFC 9106 §5.3 Argon2id test vector", () => {
    const tag = argon2Sync("argon2id", {
      message: Buffer.alloc(32, 0x01),
      nonce: Buffer.alloc(16, 0x02),
      secret: Buffer.alloc(8, 0x03),
      associatedData: Buffer.alloc(12, 0x04),
      parallelism: 4,
      tagLength: 32,
      memory: 32,
      passes: 3,
    });
    assert.equal(tag.toString("hex"), "0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659");
  });

  it("hashes to a PHC string with the OWASP parameters and a fresh salt", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    assert.match(a, /^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    assert.notEqual(a, b, "salts differ");
    assert.ok(!a.includes("correct horse battery"));
    assert.equal(needsRehash(a), false);
  });

  it("verifies the right password and rejects a wrong one", async () => {
    const stored = await hashPassword("correct horse battery");
    assert.equal(await verifyPassword("correct horse battery", stored), true);
    assert.equal(await verifyPassword("correct horse batterY", stored), false);
    assert.equal(await verifyPassword("", stored), false);
  });

  it("normalizes Unicode (NFKC) before hashing", async () => {
    const stored = await hashPassword("ﬁsh-password");
    assert.equal(await verifyPassword("fish-password", stored), true);
  });

  it("returns false for malformed or out-of-bounds hashes instead of throwing", async () => {
    const good = await hashPassword("pw-123456");
    for (const bad of [
      "",
      "plaintext",
      good.replace("argon2id", "argon2i"),
      good.replace("m=19456", "m=99999999"),
      good.replace("t=2", "t=99"),
      "$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA",
    ]) {
      assert.equal(await verifyPassword("pw-123456", bad), false, bad.slice(0, 30));
    }
    assert.equal(needsRehash("garbage"), true);
    assert.equal(needsRehash(good.replace("m=19456", "m=4096")), true);
  });

  it("dummy hash is a real hash, made once", async () => {
    const first = await dummyPasswordHash();
    assert.equal(first, await dummyPasswordHash());
    assert.equal(await verifyPassword("anything", first), false);
  });
});

describe("opaque tokens", () => {
  it("are 256-bit base64url values stored as SHA-256 hex", () => {
    const { token, hash } = generateToken();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.equal(hashToken(token), hash);
    assert.notEqual(generateToken().token, token);
  });
});
