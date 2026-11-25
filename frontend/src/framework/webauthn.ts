/**
 * WebAuthn Base64URL <-> Uint8Array & PublicKeyCredential serialization helpers.
 * Fixes navigator.credentials.create/get TypeError caused by JSON string challenges/IDs.
 */

export function base64urlToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const base64 = normalized + pad;

  let binary: string;
  if (typeof atob === "function") {
    binary = atob(base64);
  } else {
    binary = Buffer.from(base64, "base64").toString("binary");
  }

  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToBase64url(input: ArrayBuffer | ArrayBufferView): string {
  const bytes =
    input instanceof ArrayBuffer
      ? new Uint8Array(input)
      : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);

  let base64: string;
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.byteLength; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    base64 = btoa(binary);
  } else {
    base64 = Buffer.from(bytes).toString("base64");
  }

  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function convertCredentialDescriptorList(
  list: unknown,
): PublicKeyCredentialDescriptor[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return list.map((item) => {
    const desc = item as Record<string, unknown>;
    return {
      type: (desc.type as PublicKeyCredentialType) || "public-key",
      id: typeof desc.id === "string" ? base64urlToUint8Array(desc.id) : (desc.id as BufferSource),
      ...(Array.isArray(desc.transports) ? { transports: desc.transports as AuthenticatorTransport[] } : {}),
    };
  });
}

export function prepareCreationOptions(raw: Record<string, unknown>): PublicKeyCredentialCreationOptions {
  const userObj = (raw.user ?? {}) as Record<string, unknown>;
  const challenge =
    typeof raw.challenge === "string" ? base64urlToUint8Array(raw.challenge) : (raw.challenge as BufferSource);
  const userId =
    typeof userObj.id === "string" ? base64urlToUint8Array(userObj.id) : (userObj.id as BufferSource);

  const excludeCredentials = convertCredentialDescriptorList(raw.excludeCredentials);

  return {
    ...raw,
    challenge,
    user: {
      ...userObj,
      id: userId,
    },
    ...(excludeCredentials ? { excludeCredentials } : {}),
  } as unknown as PublicKeyCredentialCreationOptions;
}

export function prepareRequestOptions(raw: Record<string, unknown>): PublicKeyCredentialRequestOptions {
  const challenge =
    typeof raw.challenge === "string" ? base64urlToUint8Array(raw.challenge) : (raw.challenge as BufferSource);
  const allowCredentials = convertCredentialDescriptorList(raw.allowCredentials);

  return {
    ...raw,
    challenge,
    ...(allowCredentials ? { allowCredentials } : {}),
  } as unknown as PublicKeyCredentialRequestOptions;
}

export function serializeCredential(cred: PublicKeyCredential): Record<string, unknown> {
  const response = cred.response;
  const serializedResponse: Record<string, unknown> = {
    clientDataJSON: uint8ArrayToBase64url(response.clientDataJSON),
  };

  if ("attestationObject" in response && response.attestationObject instanceof ArrayBuffer) {
    const att = response as AuthenticatorAttestationResponse;
    serializedResponse.attestationObject = uint8ArrayToBase64url(att.attestationObject);
    if (typeof att.getTransports === "function") {
      serializedResponse.transports = att.getTransports();
    }
  } else if ("authenticatorData" in response && response.authenticatorData instanceof ArrayBuffer) {
    const assertion = response as AuthenticatorAssertionResponse;
    serializedResponse.authenticatorData = uint8ArrayToBase64url(assertion.authenticatorData);
    serializedResponse.signature = uint8ArrayToBase64url(assertion.signature);
    if (assertion.userHandle) {
      serializedResponse.userHandle = uint8ArrayToBase64url(assertion.userHandle);
    }
  }

  return {
    id: cred.id,
    rawId: uint8ArrayToBase64url(cred.rawId),
    type: cred.type,
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults:
      typeof cred.getClientExtensionResults === "function" ? cred.getClientExtensionResults() : {},
    response: serializedResponse,
  };
}
