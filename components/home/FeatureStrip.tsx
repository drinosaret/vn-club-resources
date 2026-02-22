interface FeatureStripProps {
  children: React.ReactNode;
  background?: 'white' | 'gray' | 'gradient';
  className?: string;
}

const backgroundClasses = {
  white: 'bg-white dark:bg-gray-950',
  gray: 'bg-gray-50 dark:bg-gray-900/50',
  gradient: 'bg-linear-to-r from-primary-50/30 to-transparent dark:from-primary-900/10 dark:to-transparent',
};

export function FeatureStrip({
  children,
  background = 'white',
  className = '',
}: FeatureStripProps) {
  return (
    <section className={`py-12 md:py-16 ${backgroundClasses[background]} ${className}`}>
      <div className="container mx-auto px-4 max-w-6xl">
        {children}
      </div>
    </section>
  );
}
