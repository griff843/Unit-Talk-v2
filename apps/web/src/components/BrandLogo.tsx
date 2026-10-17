import Image from 'next/image';

export function BrandLogo({
  className = '',
  compact = false,
  priority = false,
}: {
  className?: string;
  compact?: boolean;
  priority?: boolean;
}) {
  return (
    <Image
      src={
        compact
          ? '/brand/unit-talk-primary-circle.svg'
          : '/brand/unit-talk-horizontal-white.svg'
      }
      alt="Unit Talk"
      width={compact ? 256 : 2600}
      height={compact ? 256 : 800}
      className={className}
      priority={priority}
    />
  );
}
