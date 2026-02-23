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
            ContentDisposition: 'inline', // Forces browser to display instead of download
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
        // This ensures subfolders like 'assets' or 'images' are created 
        // correctly relative to the version root.
        const s3Key = `${s3Prefix}/${entry}`;

        if (fs.statSync(fullPath).isDirectory()) {
            // Recursive call for subdirectories
            await uploadDirectoryToS3(fullPath, s3Key);
        } else {
            const contentType = getContentType(entry);
            await uploadFileToS3Multipart(
                fullPath,
                s3Key,
                contentType,
                process.env.AWS_S3_BUCKET
            );
        }
    }
};

const getContentType = (fileName) => {
    const ext = fileName.split('.').pop().toLowerCase();
    const mimeTypes = {
        // Text & Code
        'html': 'text/html',
        'js': 'application/javascript',
        'mjs': 'application/javascript',
        'css': 'text/css',
        'json': 'application/json',

        // Images & Vectors
        'svg': 'image/svg+xml',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'webp': 'image/webp',
        'ico': 'image/x-icon',

        // Fonts (Critical for UI libraries like MUI)
        'woff': 'font/woff',
        'woff2': 'font/woff2',
        'ttf': 'font/ttf',
        'otf': 'font/otf',
        'eot': 'application/vnd.ms-fontobject',

        // Video & Audio
        'mp4': 'video/mp4',
        'webm': 'video/webm',
        'mp3': 'audio/mpeg',

        // Documents
        'pdf': 'application/pdf',
        'txt': 'text/plain',
        'xml': 'application/xml'
    };

    return mimeTypes[ext] || 'application/octet-stream';
};