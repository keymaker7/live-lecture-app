import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { randomSecret, sha256Hex } from "../../lib/realtime/sha256";

const node = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("SHA-256 (참가 토큰·발표자 비밀값)", () => {
  it("node:crypto 와 같은 값 — 빈 글자, 한글, 블록 경계(55·56·64바이트), 긴 글자", () => {
    const cases = ["", "abc", "하나둘셋", "a".repeat(55), "a".repeat(56), "a".repeat(64), "x".repeat(1000), randomSecret()];
    for (const c of cases) expect(sha256Hex(c)).toBe(node(c));
  });
  it("비밀값은 32자리 hex, 매번 다르다", () => {
    const a = randomSecret();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(randomSecret()).not.toBe(a);
  });
});
