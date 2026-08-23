/**
 * Image upload API.
 *
 * Wraps the generated Orval client, which builds the multipart body. No URL,
 * field name or response type is written by hand here.
 */

import { getUploads } from '@/api/generated/uploads/uploads';
import { toApiError } from '@/services/api';

const uploadsApi = getUploads();

/** Entities whose images can be uploaded. Mirrors the backend allowlist. */
export type UploadEntity = 'banners' | 'categories' | 'chains' | 'films' | 'products';

export interface UploadedImage {
  /** Application path to store in the record's image column. */
  path: string;
  mimeType?: string;
  bytes?: number;
}

/**
 * Send one image and return the value to save on the record.
 *
 * The server decides the filename and the folder; nothing about the local file
 * other than its bytes influences where it ends up.
 */
export async function uploadImage(entity: UploadEntity, file: File): Promise<UploadedImage> {
  const response = await uploadsApi.postApiUploadsEntity(entity, { file });
  const data = response.data;

  if (!data?.path) {
    throw toApiError(new Error('The server did not return an image path'));
  }

  return { path: data.path, mimeType: data.mimeType, bytes: data.bytes };
}
