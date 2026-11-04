/** Ограничения на фото заявки — те же, что в backend (LOMBARD_MAX_PHOTOS, LOMBARD_MAX_PHOTO_MB). */

export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_MAX_COUNT = 6;

/** Проверка файлов до отправки (backend проверяет то же самое ещё раз). */
export function validatePhotos(
  incoming: File[],
  current: number,
  max = PHOTO_MAX_COUNT,
  maxBytes = PHOTO_MAX_BYTES,
): { accepted: File[]; errors: string[] } {
  const accepted: File[] = [];
  const errors: string[] = [];
  for (const file of incoming) {
    if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) {
      errors.push(`«${file.name}»: нужен JPG, PNG или WebP`);
    } else if (file.size > maxBytes) {
      errors.push(`«${file.name}»: больше ${Math.round(maxBytes / 1024 / 1024)} МБ`);
    } else if (current + accepted.length >= max) {
      errors.push(`Можно загрузить не больше ${max} фото`);
      break;
    } else {
      accepted.push(file);
    }
  }
  return { accepted, errors };
}
