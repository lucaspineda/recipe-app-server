import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const client = new SecretManagerServiceClient();

export async function accessSecret(secretName: string) {
  try {
    const [version] = await client.accessSecretVersion({ name: secretName });
    const payload = version.payload?.data?.toString();
    return payload;
  } catch (error: any) {
    console.error(`Failed to access secret: ${error.message}`);
  }
}