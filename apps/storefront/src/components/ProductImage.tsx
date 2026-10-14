import Image from 'next/image';
import type { ProductImage as ProductImageData } from '@kcpw/contracts/client';
import { isOptimizableImage } from '@/lib/image-hosts';

interface Props {
  image: ProductImageData;
  /** Decorative when the product name is already adjacent (cards): pass alt="" explicitly. */
  alt?: string;
  sizes?: string;
  priority?: boolean;
}

export function ProductImage({ image, alt, sizes, priority }: Props) {
  return (
    <Image
      src={image.url}
      alt={alt ?? image.alt}
      width={image.width}
      height={image.height}
      sizes={sizes ?? '(min-width: 56em) 40vw, 100vw'}
      priority={priority}
      // SVG placeholders need no optimization. Photos are resized by Next only from the hosts in lib/image-hosts.ts
      // (next.config.ts images.remotePatterns); a photo from any other host is shown as is rather than failing the page.
      unoptimized={image.url.endsWith('.svg') || !isOptimizableImage(image.url)}
    />
  );
}
