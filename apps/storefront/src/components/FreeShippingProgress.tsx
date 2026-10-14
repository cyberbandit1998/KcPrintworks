import type { FreeShippingStatus } from '@/lib/free-shipping';

/**
 * How close the cart is to the shop's free-shipping minimum. Display only: the final shipping charge is WooCommerce's, and the
 * note under the bar says so. `status={null}` is the "still working it out" state, kept so the cart does not jump when the
 * prices arrive; it promises nothing.
 *
 * The orange fill is 3.14:1 against the track but only 2.83:1 against the paper background, so the bar is outlined in ink with an
 * ink edge on the end of the fill, and the amount is always in words and given to assistive technology as a percentage.
 */
export function FreeShippingProgress({ status }: { status: FreeShippingStatus | null }) {
  const message = status?.message ?? 'Checking your free shipping progress…';
  return (
    <div
      className="ship-progress"
      data-state={status ? (status.unlocked ? 'unlocked' : 'progress') : 'loading'}
    >
      <p className="ship-progress__message" aria-live="polite" aria-atomic="true">
        {message}
      </p>
      <div
        className="ship-progress__track"
        role="progressbar"
        aria-label="Free shipping progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={status?.percent}
        aria-valuetext={message}
        aria-busy={status ? undefined : true}
      >
        <div
          className="ship-progress__fill"
          data-empty={!status || status.percent === 0}
          style={{ width: `${status?.percent ?? 0}%` }}
        />
      </div>
      <p className="ship-progress__note">
        Your final shipping is confirmed at checkout, after any discount code.
      </p>
    </div>
  );
}
