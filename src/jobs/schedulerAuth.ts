import { OAuth2Client } from "google-auth-library";

export interface IdTokenClaims {
  email?: string;
  email_verified?: boolean;
}

/** Checks a Google-signed ID token's signature, expiry and audience, and returns its claims. */
export type VerifyIdToken = (idToken: string, audience: string) => Promise<IdTokenClaims | undefined>;

const client = new OAuth2Client();

export const verifyGoogleIdToken: VerifyIdToken = async (idToken, audience) =>
  (await client.verifyIdToken({ idToken, audience })).getPayload();

// Cloud Scheduler calls the job with an OIDC token for its own service account. The service is
// public (the web app calls it), so this check is what keeps anyone else from running the job.
export async function isFromScheduler(
  authorization: string,
  expected: { audience: string; email: string },
  verify: VerifyIdToken = verifyGoogleIdToken,
): Promise<boolean> {
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  if (!match) return false;
  try {
    const claims = await verify(match[1], expected.audience);
    return claims?.email === expected.email && claims.email_verified === true;
  } catch {
    return false;
  }
}
