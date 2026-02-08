'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Home, BookOpen, FolderOpen, Wrench, Users, ChevronDown } from 'lucide-react';
import { navigation } from '@/lib/navigation';

const sectionIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  Home: Home,
  'Start Here': BookOpen,
  Resources: FolderOpen,
  Guides: Wrench,
  Community: Users,
};

const collapsibleSections = ['Resources', 'Guides'];

interface PageNavigationProps {
  currentSlug: string;
}

export function PageNavigation({ currentSlug }: PageNavigationProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    Resources: true,
    Guides: true,
  });

  const toggleSection = (title: string) => {
    setExpanded((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  return (
    <nav className="sticky top-24 z-10 max-h-[calc(100vh-8rem)] overflow-y-auto sidebar-scroll">
      <div className="mb-3">
        <h2 className="text-base font-bold text-gray-900 dark:text-gray-100">VN Club Resources</h2>
      </div>

      <div className="space-y-4">
        {navigation.filter((section) => section.title !== 'Features').map((section) => {
          const Icon = sectionIcons[section.title];
          const isHomeSection = section.title === 'Home';
          const isCollapsible = collapsibleSections.includes(section.title);
          const isExpanded = isCollapsible ? expanded[section.title] : true;

          return (
            <div key={section.title}>
              {!isHomeSection && (
                <h3
                  className={`flex items-center gap-1.5 font-semibold text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 mb-1.5 px-1.5 ${
                    isCollapsible ? 'cursor-pointer hover:text-gray-700 dark:hover:text-gray-300' : ''
                  }`}
                  onClick={() => {
                    if (isCollapsible) {
                      toggleSection(section.title);
                    }
                  }}
                >
                  {Icon && <Icon className="w-3.5 h-3.5" />}
                  {section.title}
                  {isCollapsible && (
                    <ChevronDown
                      className={`w-3.5 h-3.5 ml-auto transition-transform duration-200 ${
                        isExpanded ? 'rotate-180' : ''
                      }`}
                    />
                  )}
                </h3>
              )}

              {isExpanded && (
                <ul className="space-y-0.5">
                  {section.items.map((item) => {
                    const isActive = currentSlug === item.slug;
                    const ItemIcon = isHomeSection ? Icon : undefined;

                    return (
                      <li key={item.slug}>
                        <Link
                          href={item.slug === '' ? '/' : `/${item.slug}`}
                          className={`flex items-center gap-1.5 py-1 px-1.5 rounded text-sm transition-colors ${
                            isActive
                              ? 'bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 font-medium'
                              : 'text-gray-700 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800/50'
                          }`}
                        >
                          {ItemIcon && <ItemIcon className="w-3.5 h-3.5" />}
                          {item.title}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}

              {!isExpanded && isCollapsible && (
                <p className="text-xs text-gray-400 dark:text-gray-500 px-1.5">
                  {section.items.length} {section.items.length === 1 ? 'page' : 'pages'}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
