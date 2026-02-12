import { Storage } from '@google-cloud/storage';
import { UploadedImage } from '../types/recipe';

const GCP_PROJECT = 'recipe-app-1bbdc';
const BUCKET_NAME = 'recipe-app-1bbdc-images';

const storage = new Storage({ projectId: GCP_PROJECT });
const bucket = storage.bucket(BUCKET_NAME);

export async function uploadRecipeImage(
  imageBuffer: Buffer,
  recipeTitle: string,
): Promise<UploadedImage> {
  const timestamp = Date.now();
  const sanitizedTitle = recipeTitle.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const filename = `recipes/${sanitizedTitle}-${timestamp}.png`;

  const file = bucket.file(filename);

  await file.save(imageBuffer, {
    metadata: {
      contentType: 'image/png',
      metadata: {
        recipeTitle,
        generatedAt: new Date().toISOString(),
      },
    },
  });

  await file.makePublic();

  const imageUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${filename}`;

  return { imageUrl, filename };
}
