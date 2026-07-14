import Link from 'next/link';

export function CTAButton({
  href,
  children,
  variant = 'primary',
  className = '',
}: {
  href: string;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
  className?: string;
}) {
  const base = variant === 'primary' ? 'ut-btn ut-btn-primary' : 'ut-btn ut-btn-secondary';
  return (
    <Link href={href} className={`${base} ut-notch-sm ${className}`.trim()}>
      {children}
    </Link>
  );
}
