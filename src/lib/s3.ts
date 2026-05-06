import { S3Client } from '@aws-sdk/client-s3'

if (!process.env.AWS_REGION) {
  throw new Error('AWS_REGION is not defined')
}

if (!process.env.AWS_ACCESS_KEY_ID) {
  throw new Error('AWS_ACCESS_KEY_ID is not defined')
}

if (!process.env.AWS_SECRET_ACCESS_KEY) {
  throw new Error('AWS_SECRET_ACCESS_KEY is not defined')
}

export const s3Client = new S3Client({
  region: process.env.AWS_REGION,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
  requestChecksumCalculation: 'WHEN_REQUIRED',
})

export const S3_BUCKET = process.env.AWS_S3_BUCKET || ''

if (!S3_BUCKET) {
  throw new Error('AWS_S3_BUCKET is not defined')
}
