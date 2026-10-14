import { permanentRedirect } from 'next/navigation';

/** "Our Story" lives at /our-story/ (its text is a WordPress page). The old address is kept so links to it still work. */
export default function AboutPage() {
  permanentRedirect('/our-story/');
}
