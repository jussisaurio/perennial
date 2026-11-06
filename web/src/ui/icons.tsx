// Hand-tuned 24px line icons. Stroke follows currentColor.

import type { ReactNode, SVGProps } from "react";

function Icon({ children, size = 20, ...rest }: SVGProps<SVGSVGElement> & { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement> & { size?: number };

export const SpeakerIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
    <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
  </Icon>
);

export const SpeakerOffIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4z" />
    <path d="M16 9.5l5 5M21 9.5l-5 5" />
  </Icon>
);

// A side-on can: the handle at the back (on top it reads as a padlock), a spout with a rose, and drops.
const can = "M5 11h8v7.5a1.5 1.5 0 0 1-1.5 1.5h-5A1.5 1.5 0 0 1 5 18.5zM5 13.5a3 3 0 0 1 0-6h3M13 15l5-5M17 8.5l2.5 2.5";
export const WateringCanIcon = (p: P) => (
  <Icon {...p}>
    <path d={can} />
    <path d="M20.5 13.5v1.2M19 16v1.2M22 16.5v1" />
  </Icon>
);

export const WateringCanOffIcon = (p: P) => (
  <Icon {...p}>
    <path d={can} />
    <path d="M3 3l18 18" />
  </Icon>
);

export const SnailIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 18h13a5 5 0 0 0 5-5" />
    <circle cx="11" cy="12.5" r="4.5" />
    <path d="M11 12.5a1.6 1.6 0 1 0 1.6-1.6M18.5 13V8.5M21 13V9" />
  </Icon>
);

export const BookIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 6.5C10 5 7 4.5 4 5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5V5c-3-.5-6 0-8 1.5z" />
    <path d="M12 6.5v13" />
  </Icon>
);

export const EarIcon = (p: P) => (
  <Icon {...p}>
    <path d="M7 9a5 5 0 0 1 10 0c0 3-3 4-3 7a3 3 0 0 1-5.5 1.6" />
    <path d="M10 9.5a2 2 0 0 1 4 0c0 1.2-1.2 1.6-1.2 2.6" />
  </Icon>
);

export const PenIcon = (p: P) => (
  <Icon {...p}>
    <path d="M14.5 5.5l4 4L9 19H5v-4z" />
    <path d="M12.5 7.5l4 4" />
  </Icon>
);

export const SeedIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 20v-6" />
    <path d="M12 14c0-4 3-6.5 7-6.5 0 4-3 6.5-7 6.5zM12 12c0-3-2.2-5-5.5-5 0 3 2.2 5 5.5 5z" />
  </Icon>
);

export const CloseIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Icon>
);

export const FlowerIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="2.2" />
    <path d="M12 5.8c0-2 1-3 2.3-2.8S16 5 14.2 6.6M14.2 8.6c1.8.9 2.6 2.2 1.8 3.3s-2.6.4-3.4-1.6M9.8 8.6c-1.8.9-2.6 2.2-1.8 3.3s2.6.4 3.4-1.6M9.8 6.6C8 5 8.3 3.2 9.7 3S12 3.8 12 5.8" />
    <path d="M12 10.5V21M12 17c-2.5 0-4-1.5-4.5-3.5 2.5 0 4 1.3 4.5 3.5ZM12 15.5c2.2 0 3.6-1.3 4-3 -2.2 0-3.6 1.1-4 3Z" />
  </Icon>
);

export const HomeIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 11l8-6.5 8 6.5" />
    <path d="M6 9.5V19h12V9.5" />
    <path d="M10 19v-5h4v5" />
  </Icon>
);

export const ListIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <circle cx="4.5" cy="6.5" r="1" />
    <circle cx="4.5" cy="12" r="1" />
    <circle cx="4.5" cy="17.5" r="1" />
  </Icon>
);

export const PlusIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const GearIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.8v2.4M12 18.8v2.4M21.2 12h-2.4M5.2 12H2.8M18.5 5.5l-1.7 1.7M7.2 16.8l-1.7 1.7M18.5 18.5l-1.7-1.7M7.2 7.2L5.5 5.5" />
  </Icon>
);

export const UndoIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 7L4.5 11.5 9 16" />
    <path d="M5 11.5h9a5 5 0 0 1 0 10h-2" />
  </Icon>
);

export const CheckIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  </Icon>
);

export const AlertIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5v5.5M12 16.5v.01" />
  </Icon>
);

export const ChevronDownIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6.5 9.5l5.5 5.5 5.5-5.5" />
  </Icon>
);

export const SproutMark = ({ size = 22 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 21v-8" stroke="var(--leaf)" strokeWidth="2" strokeLinecap="round" />
    <path d="M12 13c0-4.5 3.5-7.5 8-7.5 0 4.5-3.5 7.5-8 7.5z" fill="var(--leaf)" />
    <path d="M12 11c0-3.4-2.6-5.8-6.4-5.8 0 3.4 2.6 5.8 6.4 5.8z" fill="var(--leaf-2)" />
    <circle cx="12" cy="21" r="1.3" fill="var(--persimmon)" />
  </svg>
);

/** Google's "G" in its own colours, as Google's sign-in brand rules ask (not a line icon). */
export const GoogleMark = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);
