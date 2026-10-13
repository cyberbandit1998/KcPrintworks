import Image from 'next/image';
import type { ProductImage as ProductImageData } from '@kcpw/contracts/client';

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
      // Local SVG placeholders need no optimization. Absolute URLs (the design preview hot-links the live site's
      // photos) skip the optimizer so no remote host has to be configured; Step 2 sets remotePatterns and removes this.
      unoptimized={image.url.endsWith('.svg') || /^https?:\/\//.test(image.url)}
    />
  );
}
