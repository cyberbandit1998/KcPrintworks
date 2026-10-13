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
      // Local SVG placeholders need no optimization; remote WooCommerce images will.
      unoptimized={image.url.endsWith('.svg')}
    />
  );
}
