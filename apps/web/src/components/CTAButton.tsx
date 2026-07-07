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
  const base = variant === 'primary' ? 'ut-btn-primary' : 'ut-btn-secondary';
  return (
    <Link href={href} className={`${base} ${className}`.trim()}>
      {children}
    </Link>
  );
}
