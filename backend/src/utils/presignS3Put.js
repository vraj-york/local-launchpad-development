import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { s3 } from "./uploadFileToS3.js";

/**
 * @param {{ key: string; contentType: string; expiresIn?: number }} opts
 * @returns {Promise<string>}
 */
export async function getPresignedPutUrl({
  key,
  contentType,
  expiresIn = 3600,
}) {
  const bucket = process.env.AWS_S3_BUCKET;
  if (!bucket) {
    throw new Error("AWS_S3_BUCKET is not configured");
  }
  const cmd = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, cmd, { expiresIn });
}
