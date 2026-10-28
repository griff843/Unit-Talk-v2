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
  const base =
    variant === 'primary' ? 'ut-btn ut-btn-primary' : 'ut-btn ut-btn-secondary';
  const classNames = `${base} ut-notch-sm ${className}`.trim();

  if (/^https?:\/\//.test(href)) {
    return (
      <a
        href={href}
        className={classNames}
        target="_blank"
        rel="noopener noreferrer"
      >
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={classNames}>
      {children}
    </Link>
  );
}
