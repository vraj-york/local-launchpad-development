// s3MultipartUpload.ts
import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import fs from "fs";
import path from "path";


export const s3 = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID?.trim(),
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY?.trim(),
    },
});
export const uploadFileToS3Multipart = async (
    localFilePath,
    key,
    contentType,
    bucketName = process.env.AWS_S3_BUCKET

) => {

    const upload = new Upload({
        client: s3,
        params: {
            Bucket: bucketName,
            Key: key,
            Body: fs.createReadStream(localFilePath),
            ContentType: contentType,
        },
        queueSize: 5,          // parallel uploads
        partSize: 10 * 1024 * 1024, // 10 MB per part
        leavePartsOnError: false,
    });
    await upload.done();

    return `https://${bucketName}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
};


export const uploadDirectoryToS3 = async (dirPath, s3Prefix) => {
    const entries = fs.readdirSync(dirPath);
    for (const entry of entries) {
        const fullPath = path.join(dirPath, entry);
        const s3Key = `${s3Prefix}/${entry}`;

        if (fs.statSync(fullPath).isDirectory()) {
            await uploadDirectoryToS3(fullPath, s3Key);
        } else {
            await uploadFileToS3Multipart(
                fullPath,
                s3Key,
                getContentType(entry),
                process.env.AWS_S3_BUCKET
            );
        }
    }
};

const getContentType = (fileName) => {
    if (fileName.endsWith(".html")) return "text/html";
    if (fileName.endsWith(".js")) return "application/javascript";
    if (fileName.endsWith(".css")) return "text/css";
    if (fileName.endsWith(".json")) return "application/json";
    if (fileName.endsWith(".svg")) return "image/svg+xml";
    if (fileName.endsWith(".png")) return "image/png";
    if (fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")) return "image/jpeg";
    if (fileName.endsWith(".webp")) return "image/webp";
    if (fileName.endsWith(".woff2")) return "font/woff2";
    if (fileName.endsWith(".woff")) return "font/woff";
    if (fileName.endsWith(".ttf")) return "font/ttf";
    return "application/octet-stream";
};