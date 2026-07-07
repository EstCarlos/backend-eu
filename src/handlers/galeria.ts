import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { json } from '../shared/http';

const MEDIA_BUCKET = process.env.MEDIA_BUCKET ?? '';
const CDN_DOMAIN = process.env.CDN_DOMAIN ?? '';
const PREFIX = 'galeria/';

const EXTENSIONES = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);

const s3 = new S3Client({});

/**
 * GET /galeria — Record<diaId, url[]> con URLs de CloudFront.
 * Reemplaza a lib/galeria.ts del frontend (que leía public/images/galeria/
 * del filesystem): misma convención, keys `galeria/<dia-id>/<foto>`.
 */
export async function handler(): Promise<APIGatewayProxyResultV2> {
  const galerias: Record<string, string[]> = {};
  let continuationToken: string | undefined;

  try {
    do {
      const page = await s3.send(
        new ListObjectsV2Command({
          Bucket: MEDIA_BUCKET,
          Prefix: PREFIX,
          ContinuationToken: continuationToken,
        })
      );

      for (const objeto of page.Contents ?? []) {
        const key = objeto.Key ?? '';
        const [diaId, ...resto] = key.slice(PREFIX.length).split('/');
        const archivo = resto.join('/');

        if (!diaId || !archivo) {
          continue;
        }

        const extension = archivo.slice(archivo.lastIndexOf('.')).toLowerCase();

        if (!EXTENSIONES.has(extension)) {
          continue;
        }

        (galerias[diaId] ??= []).push(
          `https://${CDN_DOMAIN}/${PREFIX}${diaId}/${encodeURIComponent(archivo)}`
        );
      }

      continuationToken = page.NextContinuationToken;
    } while (continuationToken);
  } catch (error) {
    console.error('Error listando la galería:', error);
    return json(500, { error: 'No se pudo cargar la galería' });
  }

  for (const fotos of Object.values(galerias)) {
    fotos.sort();
  }

  return json(200, galerias, { 'cache-control': 'public, max-age=300' });
}
