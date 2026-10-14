import Image from 'next/image';
import { isOptimizableImage } from '@/lib/image-hosts';
import type { ContentImage as ContentImageData } from '@/lib/wp/types';

/** A picture from WordPress (featured image). Same host rules as product photos: resized only from the allowed hosts. */
export function ContentImage({
  image,
  alt,
  sizes,
  priority,
}: {
  image: ContentImageData;
  /** Pass "" when the title right beside it already names the picture. */
  alt?: string;
  sizes?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src={image.url}
      alt={alt ?? image.alt}
      width={image.width}
      height={image.height}
      sizes={sizes ?? '(min-width: 56em) 40vw, 100vw'}
      priority={priority}
      unoptimized={image.url.endsWith('.svg') || !isOptimizableImage(image.url)}
    />
  );
}
