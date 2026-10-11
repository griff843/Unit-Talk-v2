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
          ? '/brand/unit-talk-mark-white.svg'
          : '/brand/unit-talk-horizontal-white.svg'
      }
      alt="Unit Talk"
      width={compact ? 1000 : 2600}
      height={800}
      className={className}
      priority={priority}
    />
  );
}
