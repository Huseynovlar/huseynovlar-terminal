import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { az } from "../framework/i18n/az.ts";
import { en } from "../framework/i18n/en.ts";
import { ru } from "../framework/i18n/ru.ts";
import {
  base64urlToUint8Array,
  prepareCreationOptions,
  prepareRequestOptions,
  uint8ArrayToBase64url,
} from "../framework/webauthn.ts";

describe("WebAuthn Base64URL & Options Conversion (F01)", () => {
  it("round-trips bytes through base64url without padding", () => {
    const original = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    const encoded = uint8ArrayToBase64url(original);
    assert.ok(!encoded.includes("+") && !encoded.includes("/") && !encoded.includes("="));
    const decoded = base64urlToUint8Array(encoded);
    assert.deepEqual(Array.from(decoded), Array.from(original));
  });

  it("converts string challenge, user.id, and excludeCredentials to Uint8Array", () => {
    const prepared = prepareCreationOptions({
      challenge: "dGVzdC1jaGFsbGVuZ2U",
      rp: { name: "Huseynovlar", id: "terminal.huseynovlar.org" },
      user: { id: "dXNlci0x", name: "owner", displayName: "Owner" },
      excludeCredentials: [{ type: "public-key", id: "Y3JlZC0x" }],
    });

    assert.ok(prepared.challenge instanceof Uint8Array);
    assert.ok(prepared.user.id instanceof Uint8Array);
    assert.ok(prepared.excludeCredentials?.[0]?.id instanceof Uint8Array);
  });

  it("converts request options challenge and allowCredentials to Uint8Array", () => {
    const prepared = prepareRequestOptions({
      challenge: "bG9naW4tY2hhbGxlbmdl",
      allowCredentials: [{ type: "public-key", id: "Y3JlZC0y", transports: ["internal"] }],
    });

    assert.ok(prepared.challenge instanceof Uint8Array);
    assert.ok(prepared.allowCredentials?.[0]?.id instanceof Uint8Array);
  });
});

describe("i18n RU / EN / AZ Dictionary Parity (F02)", () => {
  it("has identical top-level sections and keys across ru, en, and az", () => {
    const ruSections = Object.keys(ru).sort();
    const enSections = Object.keys(en).sort();
    const azSections = Object.keys(az).sort();
    assert.deepEqual(enSections, ruSections);
    assert.deepEqual(azSections, ruSections);

    for (const section of ruSections as Array<keyof typeof ru>) {
      const ruKeys = Object.keys(ru[section]).sort();
      const enKeys = Object.keys(en[section]).sort();
      const azKeys = Object.keys(az[section]).sort();
      assert.deepEqual(enKeys, ruKeys, `EN keys mismatch in section ${section}`);
      assert.deepEqual(azKeys, ruKeys, `AZ keys mismatch in section ${section}`);

      for (const key of ruKeys) {
        assert.ok(
          String((ru[section] as Record<string, string>)[key]).trim().length > 0,
          `Empty RU string at ${section}.${key}`,
        );
        assert.ok(
          String((en[section] as Record<string, string>)[key]).trim().length > 0,
          `Empty EN string at ${section}.${key}`,
        );
        assert.ok(
          String((az[section] as Record<string, string>)[key]).trim().length > 0,
          `Empty AZ string at ${section}.${key}`,
        );
      }
    }
  });
});
