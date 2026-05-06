import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { s3Client, S3_BUCKET } from './s3'

/**
 * 生成预签名上传 URL
 * @param key S3 对象 key
 * @param contentType 文件 MIME 类型
 * @param expiresIn 有效期（秒）
 */
export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  expiresIn: number = 300
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ContentType: contentType,
  })

  return getSignedUrl(s3Client, command, { expiresIn })
}

/**
 * 生成预签名下载 URL
 * @param key S3 对象 key
 * @param expiresIn 有效期（秒）
 */
export async function getPresignedDownloadUrl(
  key: string,
  expiresIn: number = 300
): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  })

  return getSignedUrl(s3Client, command, { expiresIn })
}
