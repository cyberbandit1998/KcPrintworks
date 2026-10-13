'use client';

import { useState } from 'react';
import type { ProductImage as ProductImageData } from '@kcpw/contracts/client';
import { ProductImage } from './ProductImage';

export function Gallery({ images }: { images: ProductImageData[] }) {
  const [index, setIndex] = useState(0);
  const current = images[index] ?? images[0];
  if (!current) return null;
  return (
    <div className="gallery">
      <div className="gallery__main">
        <ProductImage image={current} priority sizes="(min-width: 56em) 55vw, 100vw" />
      </div>
      {images.length > 1 ? (
        <ul className="gallery__thumbs" aria-label="Product images">
          {images.map((image, i) => (
            <li key={image.id}>
              <button
                type="button"
                className="gallery__thumb"
                aria-pressed={i === index}
                aria-label={`Show image ${i + 1} of ${images.length}: ${image.alt}`}
                onClick={() => setIndex(i)}
              >
                <ProductImage image={image} alt="" sizes="72px" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
